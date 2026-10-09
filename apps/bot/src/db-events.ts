/**
 * Changes from the database the moment they commit (PostgreSQL LISTEN/NOTIFY, migration
 * `change_notifications`): a job became due, settings, reference data or bans changed. The
 * dashboard and the bot write to the same database, so this is how the bot learns about a
 * dashboard action without polling and without waiting for a cache to expire.
 *
 * One dedicated connection, outside Prisma (Prisma cannot LISTEN). It reconnects by itself; while
 * it is down the bot falls back to polling and short caches, and after a reconnect every topic
 * fires once, because notifications sent during the gap are lost.
 */
import pg from "pg";
import type { Logger } from "@mirror/core";

export const CHANGE_TOPICS = ["jobs", "settings", "reference", "bans"] as const;
export type ChangeTopic = (typeof CHANGE_TOPICS)[number];

const CHANNEL = "mirror_changes";
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export class DbEvents {
  private client: pg.Client | null = null;
  private retryMs = MIN_RETRY_MS;
  private retryTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private readonly dropped = new WeakSet<pg.Client>();
  private readonly listeners = new Map<ChangeTopic, Array<() => void>>();
  private connectionListeners: Array<(connected: boolean) => void> = [];
  connected = false;

  constructor(
    private readonly connectionString: string,
    private readonly log: Logger,
  ) {}

  on(topic: ChangeTopic, listener: () => void) {
    this.listeners.set(topic, [...(this.listeners.get(topic) ?? []), listener]);
  }

  /** Told when the connection comes up or goes down: caches are long only while it is up. */
  onConnection(listener: (connected: boolean) => void) {
    this.connectionListeners.push(listener);
  }

  start() {
    this.stopped = false;
    void this.connect();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    const client = this.client;
    this.client = null;
    this.setConnected(false);
    await client?.end().catch(() => undefined);
  }

  private emit(topic: ChangeTopic) {
    for (const listener of this.listeners.get(topic) ?? []) {
      try {
        listener();
      } catch (error) {
        this.log.warn({ err: error, topic }, "change listener failed");
      }
    }
  }

  private setConnected(connected: boolean) {
    if (this.connected === connected) return;
    this.connected = connected;
    for (const listener of this.connectionListeners) listener(connected);
  }

  private async connect() {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.connectionString, keepAlive: true, application_name: "mirror-bot-events" });
    client.on("notification", (message) => {
      const topic = message.payload as ChangeTopic | undefined;
      if (topic && (CHANGE_TOPICS as readonly string[]).includes(topic)) this.emit(topic);
    });
    client.on("error", (error) => {
      this.log.warn({ err: error }, "change listener connection error");
      this.drop(client);
    });
    client.on("end", () => this.drop(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
      this.log.warn({ err: error, retryMs: this.retryMs }, "change listener could not connect");
      this.drop(client);
      return;
    }
    if (this.stopped) {
      await client.end().catch(() => undefined);
      return;
    }
    this.client = client;
    this.retryMs = MIN_RETRY_MS;
    this.setConnected(true);
    this.log.info("listening for database changes");
    // Whatever changed while nobody listened.
    for (const topic of CHANGE_TOPICS) this.emit(topic);
  }

  /** The connection is gone: fall back to polling and retry with a growing pause. */
  private drop(client: pg.Client) {
    // «error» and «end» both arrive for one broken connection: handle it once.
    if (this.dropped.has(client)) return;
    this.dropped.add(client);
    if (this.client !== null && this.client !== client) return;
    this.client = null;
    client.removeAllListeners("notification");
    void client.end().catch(() => undefined);
    this.setConnected(false);
    if (this.stopped || this.retryTimer) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect();
    }, wait);
  }
}

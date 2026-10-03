/**
 * Service status (§6): the bot leaves a heartbeat in the database, the dashboard reads it for the
 * status page and for the «bot is down» alert. Storage and database are probed directly.
 */
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { AuditActorType, JobStatus, prisma } from "@mirror/db";
import { toJsonValue } from "./db.js";
import { getSetting, setSetting } from "./settings.js";

export const BOT_SERVICE = "bot";
/** Written by the backup container (deploy/backup/backup.sh) after every run. */
export const BACKUP_SERVICE = "backup";
/** A daily backup that is this late is reported as a failure. */
export const BACKUP_STALE_MS = 26 * 3_600_000;
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Three missed beats: the bot is considered down. */
export const HEARTBEAT_STALE_MS = 3 * HEARTBEAT_INTERVAL_MS;

export async function recordHeartbeat(service: string, meta: Record<string, unknown> = {}) {
  const data = { at: new Date(), meta: toJsonValue(meta) };
  await prisma.serviceHeartbeat.upsert({ where: { service }, create: { service, ...data }, update: data });
}

export type ServiceState = "ok" | "down" | "unknown";

export interface ServiceStatus {
  key: string;
  title: string;
  state: ServiceState;
  detail: string;
}

async function probeStorage(): Promise<ServiceStatus> {
  const base = { key: "storage", title: "Хранилище файлов" };
  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_REGION } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY || !S3_BUCKET) {
    return { ...base, state: "unknown", detail: "не настроено в окружении" };
  }
  try {
    const client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION ?? "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    });
    await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }), { abortSignal: AbortSignal.timeout(5_000) });
    return { ...base, state: "ok", detail: "бакет доступен" };
  } catch {
    return { ...base, state: "down", detail: "бакет недоступен" };
  }
}

function ago(date: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 90) return `${seconds} с назад`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} мин назад`;
  if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)} ч назад`;
  return `${Math.round(seconds / 86_400)} дн назад`;
}

export async function getBotHeartbeat() {
  return prisma.serviceHeartbeat.findUnique({ where: { service: BOT_SERVICE } });
}

export function isHeartbeatFresh(at: Date | null | undefined, now = Date.now()): boolean {
  return Boolean(at) && now - (at as Date).getTime() <= HEARTBEAT_STALE_MS;
}

/** State of the daily backup, from the row the backup container leaves behind. */
export function backupStatus(
  heartbeat: { at: Date; meta: unknown } | null,
  now = Date.now(),
): ServiceStatus {
  const base = { key: "backup", title: "Резервные копии" };
  if (!heartbeat) return { ...base, state: "unknown", detail: "копий ещё не было" };
  const meta = (heartbeat.meta ?? {}) as { state?: unknown; detail?: unknown };
  const detail = typeof meta.detail === "string" ? meta.detail : "";
  if (meta.state !== "ok") {
    return { ...base, state: "down", detail: `последняя попытка не удалась (${detail || "причина неизвестна"}), ${ago(heartbeat.at, now)}` };
  }
  if (now - heartbeat.at.getTime() > BACKUP_STALE_MS) {
    return { ...base, state: "down", detail: `копий не было больше суток, последняя ${ago(heartbeat.at, now)}` };
  }
  return { ...base, state: "ok", detail: `последняя ${ago(heartbeat.at, now)}${detail ? `: ${detail}` : ""}` };
}

/** Everything the status page shows. Never throws: a failed probe is itself a status. */
export async function getSystemStatus(): Promise<ServiceStatus[]> {
  const now = Date.now();
  const statuses: ServiceStatus[] = [];

  let databaseOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
    statuses.push({ key: "database", title: "База данных", state: "ok", detail: "отвечает" });
  } catch {
    databaseOk = false;
    statuses.push({ key: "database", title: "База данных", state: "down", detail: "нет ответа" });
  }

  if (databaseOk) {
    const heartbeat = await getBotHeartbeat();
    statuses.push(
      !heartbeat
        ? { key: "bot", title: "Бот", state: "unknown", detail: "ещё ни разу не выходил на связь" }
        : isHeartbeatFresh(heartbeat.at, now)
          ? { key: "bot", title: "Бот", state: "ok", detail: `на связи, ${ago(heartbeat.at, now)}` }
          : { key: "bot", title: "Бот", state: "down", detail: `нет связи, последний сигнал ${ago(heartbeat.at, now)}` },
    );

    const [pending, failed, oldest] = await Promise.all([
      prisma.job.count({ where: { status: JobStatus.PENDING } }),
      prisma.job.count({ where: { status: JobStatus.FAILED, updatedAt: { gte: new Date(now - 86_400_000) } } }),
      prisma.job.findFirst({
        where: { status: JobStatus.PENDING, availableAt: { lte: new Date(now) } },
        orderBy: { availableAt: "asc" },
        select: { availableAt: true },
      }),
    ]);
    // A due job that nobody picked up for minutes means the worker is stuck even if the bot is online.
    const stuck = oldest && now - oldest.availableAt.getTime() > 5 * 60_000;
    statuses.push({
      key: "queue",
      title: "Очередь задач",
      state: stuck ? "down" : "ok",
      detail: `ожидают: ${pending}, упало за сутки: ${failed}${stuck ? ` — задача ждёт с ${ago(oldest.availableAt, now)}` : ""}`,
    });
    statuses.push(backupStatus(await prisma.serviceHeartbeat.findUnique({ where: { service: BACKUP_SERVICE } }), now));
  } else {
    statuses.push({ key: "bot", title: "Бот", state: "unknown", detail: "нет доступа к базе" });
    statuses.push({ key: "queue", title: "Очередь задач", state: "unknown", detail: "нет доступа к базе" });
  }

  statuses.push(await probeStorage());
  return statuses;
}

/**
 * Decides whether the «bot is down» alert should go out now. Returns the heartbeat time to report,
 * or null. One alert per outage: a new one is possible only after the bot has come back.
 */
export async function botDownAlertDue(now = Date.now()): Promise<{ lastSeen: Date } | null> {
  const [heartbeat, alertedAt] = await Promise.all([getBotHeartbeat(), getSetting("monitoring.botDownAlertedAt")]);
  if (!heartbeat || isHeartbeatFresh(heartbeat.at, now)) return null;
  // Already alerted for this outage: the alert is newer than the last heartbeat.
  if (alertedAt && new Date(alertedAt).getTime() >= heartbeat.at.getTime()) return null;
  return { lastSeen: heartbeat.at };
}

export type BotDownAlertResult = "sent" | "not_due" | "no_webhook" | "failed";

async function postDiscordWebhook(url: string, content: string): Promise<boolean> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
}

/**
 * One pass of the watchdog the dashboard runs every minute: when the bot has gone silent, posts a
 * single message to the configured webhook. The alert is marked as sent only after Discord accepted
 * it, so a failed delivery is retried on the next pass.
 */
export async function runBotDownAlert(
  send: (url: string, content: string) => Promise<boolean> = postDiscordWebhook,
  now = Date.now(),
): Promise<BotDownAlertResult> {
  const due = await botDownAlertDue(now);
  if (!due) return "not_due";
  const url = await getSetting("monitoring.alertWebhookUrl");
  if (!url) return "no_webhook";
  const lastSeen = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(due.lastSeen);
  const delivered = await send(
    url,
    `⚠️ Бот Mirror не отвечает. Последний сигнал: ${lastSeen} МСК. Команды и кнопки сейчас не работают; заявки из очереди выполнятся после запуска.`,
  ).catch(() => false);
  if (!delivered) return "failed";
  await setSetting("monitoring.botDownAlertedAt", new Date(now).toISOString(), {
    actorType: AuditActorType.SYSTEM,
    source: "monitoring",
  });
  return "sent";
}

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AdminLevel, AuditActorType, RecordStatus, RegistrationKind } from "@mirror/db";
import {
  BACKUP_STALE_MS,
  BOT_SERVICE,
  HEARTBEAT_STALE_MS,
  MODULE_JOB_TYPES,
  SESSION_MAX_AGE_MS,
  SessionError,
  TechBanError,
  AdminRolesError,
  archiveOldAuditLog,
  assertNotTechBanned,
  backupStatus,
  botDownAlertDue,
  clearLockdownCache,
  completeAdminRoleOperation,
  createRegistration,
  createTechBan,
  createUserSession,
  createWanted,
  csvCell,
  endUserSession,
  exportRegistryCsv,
  findActiveTechBan,
  getAdminRoleOperation,
  getLockdown,
  getLockdownCached,
  getSetting,
  getSystemStatus,
  isHeartbeatFresh,
  isSessionActive,
  listSessionsForUser,
  listTechBans,
  lockdownText,
  planAdminRoles,
  recordHeartbeat,
  requestAdminRolesApply,
  revokeAllUserSessions,
  revokeTechBan,
  revokeUserSession,
  runBotDownAlert,
  setLockdown,
  setSetting,
  toCsv,
  writeAuditEvent,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(async () => {
  await resetDatabase();
  clearLockdownCache();
});
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage6.test" } as const;
const SUPER = "870000000000000001";
const ADMIN = "870000000000000002";
const PLAYER = "870000000000000003";
const DAY = 86_400_000;

const user = (discordId: string) => prisma.user.create({ data: { discordId } });

describe("emergency lockdown", () => {
  it("is off by default, records who turned it on and clears the reason when turned off", async () => {
    expect((await getLockdown()).enabled).toBe(false);

    const on = await setLockdown({ enabled: true, reason: "  обновление базы  ", actorDiscordId: SUPER }, context);
    expect(on).toMatchObject({ enabled: true, reason: "обновление базы", byDiscordId: SUPER });
    expect(lockdownText(on)).toContain("обновление базы");
    expect(await prisma.auditLog.count({ where: { entityId: "system.lockdown" } })).toBe(1);

    const off = await setLockdown({ enabled: false, reason: "ignored", actorDiscordId: SUPER }, context);
    expect(off).toMatchObject({ enabled: false, reason: "" });
    expect(lockdownText(off)).not.toContain("Причина");
  });

  it("serves hot paths from a short cache", async () => {
    expect((await getLockdownCached()).enabled).toBe(false);
    await setLockdown({ enabled: true, actorDiscordId: SUPER }, context);
    // Still the cached value: a click does not cost a query.
    expect((await getLockdownCached()).enabled).toBe(false);
    clearLockdownCache();
    expect((await getLockdownCached()).enabled).toBe(true);
  });
});

describe("technical bans", () => {
  const ban = (kind: "DISCORD" | "STATIC", value: string, by = ADMIN) =>
    createTechBan({ kind, value, reason: "спам заявками", createdByDiscordId: by }, context, {
      superAdminUserIds: [SUPER],
    });

  it("blocks an account, ends its sessions at once and lifts on revoke", async () => {
    const player = await user(PLAYER);
    const session = await createUserSession({ userId: player.id, discordId: PLAYER });
    expect(await isSessionActive(session.id)).toBe(true);

    const created = await ban("DISCORD", PLAYER);
    expect(await findActiveTechBan({ discordId: PLAYER })).toMatchObject({ id: created.id });
    await expect(assertNotTechBanned({ discordId: PLAYER })).rejects.toBeInstanceOf(TechBanError);
    expect(await isSessionActive(session.id)).toBe(false);
    await expect(ban("DISCORD", PLAYER)).rejects.toThrow("уже действует");

    await revokeTechBan(created.id, ADMIN, context);
    expect(await findActiveTechBan({ discordId: PLAYER })).toBeNull();
    await expect(revokeTechBan(created.id, ADMIN, context)).rejects.toBeInstanceOf(TechBanError);
    // History stays; a new ban of the same account is possible again.
    await ban("DISCORD", PLAYER);
    expect((await listTechBans()).map((row) => row.status).sort()).toEqual([RecordStatus.ACTIVE, RecordStatus.REVOKED]);
    expect(await listTechBans({ activeOnly: true })).toHaveLength(1);
  });

  it("never locks out a super admin or the admin themself, and validates the id", async () => {
    await expect(ban("DISCORD", SUPER)).rejects.toThrow("Главного администратора");
    await expect(ban("DISCORD", ADMIN, ADMIN)).rejects.toThrow("самого себя");
    await expect(ban("DISCORD", "not-an-id")).rejects.toThrow();
    expect(await prisma.techBan.count()).toBe(0);
  });

  it("refuses applications that name a banned static", async () => {
    await ban("STATIC", "777");
    await expect(
      createRegistration(
        { kind: RegistrationKind.UNIFORM, staticId: "777", applicantDiscordId: PLAYER, payload: { description: "форма" } },
        context,
      ),
    ).rejects.toThrow("Статик 777 заблокирован");
    // Another static is unaffected.
    await createRegistration(
      { kind: RegistrationKind.UNIFORM, staticId: "778", applicantDiscordId: PLAYER, payload: { description: "форма" } },
      context,
    );
    expect(await prisma.registration.count()).toBe(1);
  });
});

describe("dashboard sessions", () => {
  it("tracks every sign-in and honours only live sessions", async () => {
    const player = await user(PLAYER);
    const first = await createUserSession({
      userId: player.id,
      discordId: PLAYER,
      ipAddress: "203.0.113.7",
      userAgent: "x".repeat(500),
    });
    expect(first.userAgent).toHaveLength(300);
    expect(await isSessionActive(first.id)).toBe(true);
    expect(await isSessionActive("missing")).toBe(false);

    // Activity is recorded, but not on every request.
    await prisma.userSession.update({ where: { id: first.id }, data: { lastSeenAt: new Date(Date.now() - 10 * 60_000) } });
    await isSessionActive(first.id);
    const touched = await prisma.userSession.findUniqueOrThrow({ where: { id: first.id } });
    expect(Date.now() - touched.lastSeenAt.getTime()).toBeLessThan(5_000);

    // Older than the cookie lifetime: dead even without an explicit sign-out.
    await prisma.userSession.update({
      where: { id: first.id },
      data: { createdAt: new Date(Date.now() - SESSION_MAX_AGE_MS - 1000) },
    });
    expect(await isSessionActive(first.id)).toBe(false);
  });

  it("lets a user end own sessions, and only a super admin end someone else's", async () => {
    const player = await user(PLAYER);
    const other = await user(ADMIN);
    const own = await createUserSession({ userId: player.id, discordId: PLAYER });
    const foreign = await createUserSession({ userId: other.id, discordId: ADMIN });
    const actor = { userId: player.id, discordId: PLAYER };

    await expect(revokeUserSession(foreign.id, { ...actor, allowForeign: false }, context)).rejects.toBeInstanceOf(
      SessionError,
    );
    expect(await isSessionActive(foreign.id)).toBe(true);

    await revokeUserSession(foreign.id, { ...actor, allowForeign: true }, context);
    expect(await isSessionActive(foreign.id)).toBe(false);
    await expect(revokeUserSession(foreign.id, { ...actor, allowForeign: true }, context)).rejects.toThrow("уже завершена");

    await revokeUserSession(own.id, { ...actor, allowForeign: false }, context);
    expect(await isSessionActive(own.id)).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "session.revoked" } })).toBe(2);
  });

  it("signs out everywhere except the current session", async () => {
    const player = await user(PLAYER);
    const current = await createUserSession({ userId: player.id, discordId: PLAYER });
    const phone = await createUserSession({ userId: player.id, discordId: PLAYER });
    const laptop = await createUserSession({ userId: player.id, discordId: PLAYER });

    expect(await revokeAllUserSessions({ userId: player.id, exceptSessionId: current.id }, PLAYER, context)).toBe(2);
    expect(await isSessionActive(current.id)).toBe(true);
    expect(await isSessionActive(phone.id)).toBe(false);
    expect(await isSessionActive(laptop.id)).toBe(false);

    // Live sessions come first in the list; ended ones stay as history.
    const listed = await listSessionsForUser(player.id);
    expect(listed).toHaveLength(3);
    expect(listed[0]?.id).toBe(current.id);

    await endUserSession(current.id, PLAYER);
    expect(await isSessionActive(current.id)).toBe(false);
  });
});

describe("global admin roles", () => {
  const sets = {
    "100000000000000001": { SUPER_ADMIN: ["1"], SENIOR_ADMIN: ["2"], ADMIN: ["3", "4"], HELPER: ["5"] },
    "100000000000000002": { SUPER_ADMIN: [], SENIOR_ADMIN: [], ADMIN: ["9"], HELPER: ["9"] },
    "100000000000000003": { SUPER_ADMIN: [], SENIOR_ADMIN: [], ADMIN: [], HELPER: [] },
  };

  it("plans what to grant and what to take away on every configured guild", () => {
    expect(planAdminRoles(sets, AdminLevel.ADMIN)).toEqual([
      { guildDiscordId: "100000000000000001", add: ["3", "4"], remove: ["1", "2", "5"] },
      // A role shared by two levels is kept, not removed.
      { guildDiscordId: "100000000000000002", add: ["9"], remove: [] },
    ]);
    expect(planAdminRoles(sets, AdminLevel.SUPER_ADMIN)).toEqual([
      { guildDiscordId: "100000000000000001", add: ["1"], remove: ["2", "3", "4", "5"] },
      { guildDiscordId: "100000000000000002", add: [], remove: ["9"] },
    ]);
    // Removing the level takes every admin role.
    expect(planAdminRoles(sets, null)).toEqual([
      { guildDiscordId: "100000000000000001", add: [], remove: ["1", "2", "3", "4", "5"] },
      { guildDiscordId: "100000000000000002", add: [], remove: ["9"] },
    ]);
    expect(planAdminRoles({}, AdminLevel.HELPER)).toEqual([]);
  });

  it("queues the operation for the bot and stores its per-guild report", async () => {
    const request = { targetDiscordId: PLAYER, level: AdminLevel.HELPER, requestedByDiscordId: SUPER };
    await expect(requestAdminRolesApply(request, context)).rejects.toBeInstanceOf(AdminRolesError);
    await expect(requestAdminRolesApply({ ...request, targetDiscordId: "abc" }, context)).rejects.toThrow();

    await setSetting(
      "adminRoles.byGuild",
      { "100000000000000001": { SUPER_ADMIN: [], SENIOR_ADMIN: [], ADMIN: [], HELPER: ["100000000000000055"] } },
      context,
    );
    const operation = await requestAdminRolesApply(request, context);
    expect(operation.status).toBe("PENDING");
    const job = await prisma.job.findFirstOrThrow({ where: { type: MODULE_JOB_TYPES.ADMIN_ROLES_APPLY } });
    expect(job.payload).toEqual({ operationId: operation.id });

    await completeAdminRoleOperation(operation.id, [
      { guildDiscordId: "100000000000000001", guildName: "Main", outcome: "changed", added: ["100000000000000055"], removed: [], detail: null },
      { guildDiscordId: "100000000000000002", guildName: "ЧП", outcome: "not_member", added: [], removed: [], detail: null },
    ]);
    const done = await getAdminRoleOperation(operation.id);
    expect(done).toMatchObject({ status: "DONE" });
    expect(done?.completedAt).toBeInstanceOf(Date);
    expect(done?.report).toHaveLength(2);

    // Nothing could be applied anywhere: the operation is reported as failed.
    const second = await requestAdminRolesApply({ ...request, level: null }, context);
    await completeAdminRoleOperation(second.id, [
      { guildDiscordId: "100000000000000001", guildName: "Main", outcome: "failed", added: [], removed: [], detail: "нет прав" },
    ]);
    expect((await getAdminRoleOperation(second.id))?.status).toBe("FAILED");
  });
});

describe("monitoring", () => {
  it("knows a fresh heartbeat from a stale one", () => {
    const now = Date.now();
    expect(isHeartbeatFresh(new Date(now - 1000), now)).toBe(true);
    expect(isHeartbeatFresh(new Date(now - HEARTBEAT_STALE_MS - 1), now)).toBe(false);
    expect(isHeartbeatFresh(null, now)).toBe(false);
  });

  it("reports the bot, the queue and the database on the status page", async () => {
    const byKey = async () => new Map((await getSystemStatus()).map((row) => [row.key, row]));

    let status = await byKey();
    expect(status.get("database")?.state).toBe("ok");
    expect(status.get("bot")?.state).toBe("unknown");
    expect(status.get("queue")?.state).toBe("ok");
    expect(status.get("backup")?.state).toBe("unknown");

    await recordHeartbeat(BOT_SERVICE, { guilds: 2 });
    status = await byKey();
    expect(status.get("bot")?.state).toBe("ok");

    await prisma.serviceHeartbeat.update({
      where: { service: BOT_SERVICE },
      data: { at: new Date(Date.now() - HEARTBEAT_STALE_MS - 60_000) },
    });
    // A due job nobody picked up for minutes: the worker is stuck.
    await prisma.job.create({
      data: { type: "test.stuck", payload: {}, availableAt: new Date(Date.now() - 10 * 60_000) },
    });
    status = await byKey();
    expect(status.get("bot")?.state).toBe("down");
    expect(status.get("queue")?.state).toBe("down");
  });

  it("judges the daily backup by the row the backup container leaves", () => {
    const now = Date.now();
    expect(backupStatus(null, now).state).toBe("unknown");
    expect(backupStatus({ at: new Date(now - 3_600_000), meta: { state: "ok", detail: "дамп 1M" } }, now)).toMatchObject({
      state: "ok",
      detail: expect.stringContaining("дамп 1M"),
    });
    expect(backupStatus({ at: new Date(now - 60_000), meta: { state: "failed", detail: "pg_dump" } }, now).state).toBe("down");
    expect(backupStatus({ at: new Date(now - BACKUP_STALE_MS - 1), meta: { state: "ok" } }, now).state).toBe("down");
  });

  it("alerts once per outage, retries a failed delivery and re-arms after the bot returns", async () => {
    const sent: string[] = [];
    const send = async (url: string, content: string) => {
      sent.push(`${url} ${content}`);
      return true;
    };

    // Never seen and alive: nothing to report.
    expect(await runBotDownAlert(send)).toBe("not_due");
    await recordHeartbeat(BOT_SERVICE);
    expect(await runBotDownAlert(send)).toBe("not_due");

    const silence = () =>
      prisma.serviceHeartbeat.update({
        where: { service: BOT_SERVICE },
        data: { at: new Date(Date.now() - HEARTBEAT_STALE_MS - 60_000) },
      });
    await silence();
    expect(await botDownAlertDue()).not.toBeNull();
    expect(await runBotDownAlert(send)).toBe("no_webhook");

    await setSetting("monitoring.alertWebhookUrl", "https://discord.com/api/webhooks/1/token", context);
    // Discord refused: not marked as sent, so the next pass tries again.
    expect(await runBotDownAlert(async () => false)).toBe("failed");
    expect(await runBotDownAlert(async () => Promise.reject(new Error("network")))).toBe("failed");
    expect(await getSetting("monitoring.botDownAlertedAt")).toBeNull();

    expect(await runBotDownAlert(send)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("не отвечает");
    expect(await runBotDownAlert(send)).toBe("not_due");

    // The bot came back and died again: a new outage, a new alert.
    await recordHeartbeat(BOT_SERVICE);
    expect(await runBotDownAlert(send)).toBe("not_due");
    await prisma.serviceHeartbeat.update({
      where: { service: BOT_SERVICE },
      data: { at: new Date(Date.now() + 1000) },
    });
    expect(await runBotDownAlert(send, Date.now() + HEARTBEAT_STALE_MS + 120_000)).toBe("sent");
    expect(sent).toHaveLength(2);
  });
});

describe("registry export", () => {
  it("writes Excel-friendly CSV and defuses spreadsheet formulas", async () => {
    expect(csvCell('say "hi"; ok')).toBe('"say ""hi""; ok"');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(new Date("2026-01-02T03:04:05.000Z"))).toBe('"2026-01-02T03:04:05.000Z"');

    const csv = toCsv(["a", "b"], [[1, "x"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('"a";"b"\r\n"1";"x"\r\n');
  });

  it("exports a whole registry, newest first", async () => {
    await createWanted(
      { number: "W-1", characterName: "Ivan Petrov", staticId: "111", reason: "=cmd", termText: "5 лет", forumLink: "https://forum.example/t", issuedByDiscordId: SUPER },
      context,
    );
    await createWanted(
      { number: "W-2", characterName: "Petr Ivanov", staticId: "222", reason: "ст. 2", termText: "1 год", forumLink: "https://forum.example/t", issuedByDiscordId: SUPER },
      context,
    );
    const lines = (await exportRegistryCsv("wanted")).slice(1).trimEnd().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"Номер";"ФИО";"Паспорт"');
    expect(lines.slice(1).some((line) => line.startsWith('"W-1";"Ivan Petrov";"111";"\'=cmd"'))).toBe(true);

    // Empty registries still give a header.
    for (const registry of ["documents", "fines", "personnel", "ic-blacklist", "registrations-vehicles", "registrations-uniforms", "tokens"] as const) {
      expect((await exportRegistryCsv(registry)).slice(1).trimEnd().split("\r\n")).toHaveLength(1);
    }
  });
});

describe("audit log archive", () => {
  it("moves rows older than the limit in batches and loses nothing", async () => {
    const event = { ...context, action: "test.event", entityType: "test" };
    for (let index = 0; index < 5; index += 1) {
      await writeAuditEvent({ ...event, entityId: `old-${index}` });
    }
    await prisma.auditLog.updateMany({ data: { createdAt: new Date(Date.now() - 400 * DAY) } });
    await writeAuditEvent({ ...event, entityId: "recent" });

    expect(await archiveOldAuditLog(new Date(), 3)).toBe(3);
    expect(await archiveOldAuditLog(new Date(), 3)).toBe(2);
    expect(await archiveOldAuditLog(new Date(), 3)).toBe(0);

    expect(await prisma.auditLog.findMany({ select: { entityId: true } })).toEqual([{ entityId: "recent" }]);
    const archived = await prisma.auditLogArchive.findMany();
    expect(archived).toHaveLength(5);
    expect(archived.map((row) => (row.payload as { entityId: string }).entityId).sort()).toEqual(
      ["old-0", "old-1", "old-2", "old-3", "old-4"],
    );

    // The age limit is a setting.
    await setSetting("audit.archiveAfterDays", 30, context);
    await prisma.auditLog.updateMany({ where: { entityId: "recent" }, data: { createdAt: new Date(Date.now() - 31 * DAY) } });
    expect(await archiveOldAuditLog()).toBeGreaterThanOrEqual(1);
    expect(await prisma.auditLog.count({ where: { entityId: "recent" } })).toBe(0);
  });
});

describe("settings whose value is an object", () => {
  it("can be empty: `{}` is a value, not a missing one", async () => {
    // What the seed writes for a fresh installation, and what saving «no roles» writes.
    await prisma.systemSetting.create({ data: { key: "adminRoles.byGuild", value: {} } });
    expect(await getSetting("adminRoles.byGuild")).toEqual({});
    await setSetting("adminRoles.byGuild", {}, context);
    expect(await getSetting("adminRoles.byGuild")).toEqual({});
    // Nullable settings keep the old rule: an empty object stored for them still means «not set».
    await prisma.systemSetting.create({ data: { key: "monitoring.errorChannelId", value: {} } });
    expect(await getSetting("monitoring.errorChannelId")).toBeNull();
  });
});

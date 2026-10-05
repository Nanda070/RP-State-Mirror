import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, DecisionStatus, RecordStatus, RegistrationKind } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  REGISTRATION_LEFT_REASON,
  closeRegistrationsOfLeavers,
  createRegistration,
  decideRegistration,
  markGuildUnavailable,
  markMemberLeft,
  seedFoundation,
  setSetting,
  upsertGuild,
  upsertMember,
  type MemberSnapshot,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

const context = { actorType: AuditActorType.SYSTEM, source: "improve.test" } as const;

const LSPD_GUILD = "200000000000000002";
const FIB_GUILD = "200000000000000003";
const MAIN_GUILD = "200000000000000001";
const HOUR_MS = 3_600_000;

beforeEach(async () => {
  await resetDatabase();
  await seedFoundation({ superAdminUserIds: [] });
  const lspd = await upsertGuild({ discordId: LSPD_GUILD, name: "LSPD", iconUrl: null });
  const fib = await upsertGuild({ discordId: FIB_GUILD, name: "FIB", iconUrl: null });
  await upsertGuild({ discordId: MAIN_GUILD, name: "Main", iconUrl: null });
  await prisma.faction.update({ where: { code: "LSPD" }, data: { guildId: lspd.id } });
  await prisma.faction.update({ where: { code: "FIB" }, data: { guildId: fib.id } });
});
afterAll(() => prisma.$disconnect());

function member(userDiscordId: string): MemberSnapshot {
  return {
    userDiscordId,
    username: `user-${userDiscordId}`,
    globalName: null,
    nickname: null,
    avatarUrl: null,
    guildAvatarUrl: null,
    roleIds: [],
    joinedAt: null,
  };
}

let plates = 0;

async function register(discordId: string, kind: RegistrationKind = RegistrationKind.VEHICLE, approve = true) {
  plates += 1;
  const registration = await createRegistration(
    {
      kind,
      staticId: `S-${discordId}`,
      applicantDiscordId: discordId,
      payload: kind === RegistrationKind.VEHICLE ? { model: "Sultan", plate: `A${100 + plates}AA` } : { description: "Форма" },
    },
    context,
  );
  if (approve) await decideRegistration(registration.id, DecisionStatus.APPROVED, "admin", null, context);
  return registration.id;
}

const later = (hours: number) => new Date(Date.now() + hours * HOUR_MS);
const stored = (id: string) => prisma.registration.findUniqueOrThrow({ where: { id } });

describe("registrations of people who left their faction", () => {
  it("revokes an approved registration once the grace period is over, not before", async () => {
    await upsertMember(LSPD_GUILD, member("501"));
    const id = await register("501");
    await markMemberLeft(LSPD_GUILD, "501");

    expect(await closeRegistrationsOfLeavers(later(23))).toEqual({ closed: 0, held: 0 });
    expect((await stored(id)).status).toBe(RecordStatus.ACTIVE);

    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 1, held: 0 });
    const row = await stored(id);
    expect(row.status).toBe(RecordStatus.REVOKED);
    expect(row.rejectionReason).toBe(REGISTRATION_LEFT_REASON);

    const job = await prisma.job.findFirst({ where: { type: MODULE_JOB_TYPES.REGISTRATION_EXPIRED } });
    expect(job?.payload).toMatchObject({ registrationId: id });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "registration.left_faction" } });
    expect(audit.source).toBe("registrations.left_faction");

    // Nothing left to do, and the static and the plate are free again.
    expect(await closeRegistrationsOfLeavers(later(26))).toEqual({ closed: 0, held: 0 });
    await upsertMember(LSPD_GUILD, member("501"));
    await expect(register("501", RegistrationKind.VEHICLE, false)).resolves.toBeTruthy();
  });

  it("treats a uniform registration the same way", async () => {
    await upsertMember(LSPD_GUILD, member("502"));
    const id = await register("502", RegistrationKind.UNIFORM);
    await markMemberLeft(LSPD_GUILD, "502");
    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 1, held: 0 });
    expect((await stored(id)).status).toBe(RecordStatus.REVOKED);
  });

  it("closes an application that was still waiting for a decision", async () => {
    await upsertMember(LSPD_GUILD, member("503"));
    const id = await register("503", RegistrationKind.VEHICLE, false);
    await markMemberLeft(LSPD_GUILD, "503");
    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 1, held: 0 });
    const row = await stored(id);
    expect(row).toMatchObject({
      status: RecordStatus.CLOSED,
      decision: DecisionStatus.REJECTED,
      rejectionReason: REGISTRATION_LEFT_REASON,
    });
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.REGISTRATION_DECIDED } })).toBe(1);
  });

  it("keeps the registration of someone who moved to another faction or came back", async () => {
    await upsertMember(LSPD_GUILD, member("504"));
    await upsertMember(LSPD_GUILD, member("505"));
    const moved = await register("504");
    const returned = await register("505");
    await markMemberLeft(LSPD_GUILD, "504");
    await markMemberLeft(LSPD_GUILD, "505");
    await upsertMember(FIB_GUILD, member("504"));
    await upsertMember(LSPD_GUILD, member("505"));

    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 0, held: 0 });
    expect((await stored(moved)).status).toBe(RecordStatus.ACTIVE);
    expect((await stored(returned)).status).toBe(RecordStatus.ACTIVE);
  });

  it("does not count a guild that is not a faction guild, or one the bot lost", async () => {
    // Left the main guild only: that is not a dismissal.
    await upsertMember(MAIN_GUILD, member("506"));
    await upsertMember(LSPD_GUILD, member("506"));
    const stays = await register("506");
    await markMemberLeft(MAIN_GUILD, "506");

    // The faction guild was deleted; nobody left it.
    await upsertMember(FIB_GUILD, member("507"));
    const untouched = await register("507");
    await markGuildUnavailable(FIB_GUILD);

    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 0, held: 0 });
    expect((await stored(stays)).status).toBe(RecordStatus.ACTIVE);
    expect((await stored(untouched)).status).toBe(RecordStatus.ACTIVE);
  });

  it("leaves alone a registration filed after the person had already left", async () => {
    await upsertMember(LSPD_GUILD, member("508"));
    await markMemberLeft(LSPD_GUILD, "508");
    await prisma.guildMember.updateMany({
      where: { userDiscordId: "508" },
      data: { leftAt: new Date(Date.now() - 48 * HOUR_MS) },
    });
    const id = await register("508");
    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 0, held: 0 });
    expect((await stored(id)).status).toBe(RecordStatus.ACTIVE);
  });

  it("closes nothing when one pass would close more than the limit", async () => {
    await setSetting("registrations.leaveMaxPerPass", 2, context);
    const ids: string[] = [];
    for (const user of ["511", "512", "513"]) {
      await upsertMember(LSPD_GUILD, member(user));
      ids.push(await register(user));
      await markMemberLeft(LSPD_GUILD, user);
    }
    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 0, held: 3 });
    for (const id of ids) expect((await stored(id)).status).toBe(RecordStatus.ACTIVE);

    await setSetting("registrations.leaveMaxPerPass", 3, context);
    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 3, held: 0 });
  });

  it("does nothing while the rule is switched off, and follows the configured grace period", async () => {
    await upsertMember(LSPD_GUILD, member("520"));
    const id = await register("520");
    await markMemberLeft(LSPD_GUILD, "520");

    await setSetting("registrations.closeOnLeave", false, context);
    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 0, held: 0 });

    await setSetting("registrations.closeOnLeave", true, context);
    await setSetting("registrations.leaveGraceHours", 72, context);
    expect(await closeRegistrationsOfLeavers(later(25))).toEqual({ closed: 0, held: 0 });
    expect(await closeRegistrationsOfLeavers(later(73))).toEqual({ closed: 1, held: 0 });
    expect((await stored(id)).status).toBe(RecordStatus.REVOKED);
  });
});

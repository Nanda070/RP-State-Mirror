import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, LawyerCallStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  acceptLawyerCall,
  cancelLawyerCall,
  createLawyerCall,
  lawyerCallPlaceLabel,
  publishLawyerCallPanel,
  setSetting,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "lawyer-calls.test" } as const;
const CALLER = "930000000000000001";
const LAWYER = "930000000000000002";
const OTHER_LAWYER = "930000000000000003";
const INCIDENT = "930000000000000100";
const OTHER_GUILD = "930000000000000101";
const CHANNEL = "930000000000000200";
const LAWYER_ROLE = "930000000000000300";

const call = {
  callerDiscordId: CALLER,
  callerName: "John Doe",
  guildDiscordId: INCIDENT,
  channelDiscordId: CHANNEL,
  place: "lspd_kpz",
} as const;

async function configure() {
  await setSetting("core.incidentGuildId", INCIDENT, context);
  await setSetting("lawyerCalls.lawyerRoleIds", [LAWYER_ROLE], context);
}

describe("вызов адвоката", () => {
  it("works only on the ЧП server and only with a lawyer role set", async () => {
    await setSetting("core.incidentGuildId", INCIDENT, context);
    await expect(createLawyerCall(call, context)).rejects.toThrow(/Роль адвоката не настроена/);
    await setSetting("lawyerCalls.lawyerRoleIds", [LAWYER_ROLE], context);
    await expect(createLawyerCall({ ...call, guildDiscordId: OTHER_GUILD }, context)).rejects.toThrow(/сервере ЧП/);
    await expect(createLawyerCall({ ...call, place: "nowhere" }, context)).rejects.toThrow(/место/);
    expect(await prisma.lawyerCall.count()).toBe(0);
  });

  it("records the call and writes the journal", async () => {
    await configure();
    const created = await createLawyerCall(call, context);
    expect(created).toMatchObject({ status: LawyerCallStatus.PENDING, place: "lspd_kpz", callerName: "John Doe" });
    expect(lawyerCallPlaceLabel(created.place)).toBe("КПЗ LSPD");
    const audit = await prisma.auditLog.findMany({ where: { entityType: "lawyer_call" } });
    expect(audit.map((event) => event.action)).toEqual(["lawyer_call.created"]);
  });

  it("is taken by one lawyer only", async () => {
    await configure();
    const created = await createLawyerCall(call, context);

    await expect(acceptLawyerCall(created.id, { discordId: LAWYER, roleIds: [] }, context)).rejects.toThrow(/только адвокат/);
    await expect(
      acceptLawyerCall(created.id, { discordId: CALLER, roleIds: [LAWYER_ROLE] }, context),
    ).rejects.toThrow(/Свой вызов/);

    const results = await Promise.allSettled([
      acceptLawyerCall(created.id, { discordId: LAWYER, roleIds: [LAWYER_ROLE] }, context),
      acceptLawyerCall(created.id, { discordId: OTHER_LAWYER, roleIds: [LAWYER_ROLE] }, context),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/уже принят/);

    const stored = await prisma.lawyerCall.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.status).toBe(LawyerCallStatus.ACCEPTED);
    expect([LAWYER, OTHER_LAWYER]).toContain(stored.acceptedByDiscordId);
    expect(stored.acceptedAt).toBeInstanceOf(Date);
    await expect(cancelLawyerCall(created.id, CALLER, context)).rejects.toThrow(/уже принят/);
  });

  it("is cancelled by the caller only, and then cannot be taken", async () => {
    await configure();
    const created = await createLawyerCall(call, context);
    await expect(cancelLawyerCall(created.id, LAWYER, context)).rejects.toThrow(/только тот/);
    const cancelled = await cancelLawyerCall(created.id, CALLER, context);
    expect(cancelled.status).toBe(LawyerCallStatus.CANCELLED);
    await expect(
      acceptLawyerCall(created.id, { discordId: LAWYER, roleIds: [LAWYER_ROLE] }, context),
    ).rejects.toThrow(/отменён/);
  });

  it("publishes the button panel only into a channel of the ЧП server", async () => {
    await configure();
    const incident = await prisma.guild.create({ data: { discordId: INCIDENT, name: "ЧП" } });
    const other = await prisma.guild.create({ data: { discordId: OTHER_GUILD, name: "FIB" } });
    await prisma.discordChannel.create({ data: { discordId: CHANNEL, name: "адвокаты", guildId: incident.id } });
    await prisma.discordChannel.create({ data: { discordId: "930000000000000201", name: "fib", guildId: other.id } });

    await expect(publishLawyerCallPanel({ channelDiscordId: "930000000000000201" }, context)).rejects.toThrow(/сервера ЧП/);
    await publishLawyerCallPanel({ channelDiscordId: CHANNEL, messageText: "  " }, context);
    const jobs = await prisma.job.findMany({ where: { type: MODULE_JOB_TYPES.LAWYER_CALL_PANEL_PUBLISH } });
    expect(jobs.map((job) => job.payload)).toEqual([
      { guildDiscordId: INCIDENT, channelDiscordId: CHANNEL, messageText: null },
    ]);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  RAGE_VEHICLES,
  createVehicleRequest,
  findRageVehicle,
  searchRageVehicles,
  setSetting,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "vehicle-requests.test" } as const;
const PLAYER = "920000000000000001";
const GUILD = "920000000000000100";
const CHANNEL = "920000000000000200";
const ROLE = "920000000000000300";

describe("vehicle list", () => {
  it("knows the game's vehicles by spawn name", () => {
    expect(RAGE_VEHICLES.length).toBeGreaterThan(700);
    expect(new Set(RAGE_VEHICLES.map((vehicle) => vehicle.model)).size).toBe(RAGE_VEHICLES.length);
    expect(findRageVehicle(" Adder ")).toEqual({ model: "adder", category: "Суперкары" });
    expect(findRageVehicle("police")?.category).toBe("Экстренные службы");
    expect(findRageVehicle("not-a-car")).toBeNull();
  });

  it("suggests names that start with the typed text before names that contain it", () => {
    const found = searchRageVehicles("poli").map((vehicle) => vehicle.model);
    expect(found.length).toBeGreaterThan(3);
    expect(found.length).toBeLessThanOrEqual(25);
    const firstContains = found.findIndex((model) => !model.startsWith("poli"));
    const lastStarts = found.map((model) => model.startsWith("poli")).lastIndexOf(true);
    expect(firstContains === -1 || firstContains > lastStarts).toBe(true);
    // Discord shows at most 25 choices.
    expect(searchRageVehicles("")).toHaveLength(25);
    expect(searchRageVehicles("zzzzzz")).toEqual([]);
  });
});

describe("/запрос-тс", () => {
  const request = {
    requesterDiscordId: PLAYER,
    guildDiscordId: GUILD,
    requesterIsAdmin: false,
    requesterIsStaff: false,
    requesterRoleIds: [] as string[],
    model: "Police3",
    reason: "Патруль на мероприятии",
    time: "сегодня 20:00 МСК",
  };

  /** A Discord server tied to the FIB faction. */
  async function factionGuild() {
    const guild = await prisma.guild.create({ data: { discordId: GUILD, name: "FIB | Mirror" } });
    await prisma.faction.create({ data: { code: "FIB", name: "Federal Investigation Bureau", guildId: guild.id } });
    return guild;
  }

  it("is refused until a channel is chosen in the dashboard", async () => {
    await factionGuild();
    await expect(createVehicleRequest(request, context)).rejects.toThrow(/не настроен/);
    expect(await prisma.job.count()).toBe(0);
  });

  it("queues the message for the admins and writes the journal", async () => {
    await factionGuild();
    await setSetting("vehicleRequests.channelId", CHANNEL, context);
    await setSetting("vehicleRequests.pingRoleIds", [ROLE], context);

    const created = await createVehicleRequest(request, context);
    expect(created).toMatchObject({ model: "police3", category: "Экстренные службы", time: "сегодня 20:00 МСК" });

    const jobs = await prisma.job.findMany({ where: { type: MODULE_JOB_TYPES.VEHICLE_REQUEST_SEND } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({
      requesterDiscordId: PLAYER,
      guildDiscordId: GUILD,
      guildName: "FIB | Mirror",
      factionCodes: ["FIB"],
      model: "police3",
      category: "Экстренные службы",
      reason: "Патруль на мероприятии",
      time: "сегодня 20:00 МСК",
    });
    expect(await prisma.auditLog.count({ where: { action: "vehicle_request.created", entityId: jobs[0]?.id ?? "" } })).toBe(1);
  });

  it("works on every faction's server; elsewhere only for faction members and admins", async () => {
    await setSetting("vehicleRequests.channelId", CHANNEL, context);
    const other = "920000000000000101";
    await prisma.guild.create({ data: { discordId: other, name: "Чужой сервер" } });

    // No faction behind the server: an outsider is refused, a faction member or an admin is not.
    await expect(createVehicleRequest({ ...request, guildDiscordId: other }, context)).rejects.toThrow(/с сервера фракции/);
    const staff = await createVehicleRequest({ ...request, guildDiscordId: other, requesterIsStaff: true }, context);
    expect(staff).toMatchObject({ guildName: "Чужой сервер", factionCodes: [] });
    await expect(createVehicleRequest({ ...request, guildDiscordId: null }, context)).rejects.toThrow(/только на сервере/);

    // An archived faction no longer makes a server a faction's server.
    await factionGuild();
    await prisma.faction.updateMany({ where: { code: "FIB" }, data: { status: RecordStatus.ARCHIVED } });
    await expect(createVehicleRequest(request, context)).rejects.toThrow(/с сервера фракции/);
  });

  it("lets the dashboard choose which roles may ask on which server", async () => {
    await setSetting("vehicleRequests.channelId", CHANNEL, context);
    const fib = await factionGuild();
    const otherId = "920000000000000102";
    const other = await prisma.guild.create({ data: { discordId: otherId, name: "LSPD | Mirror" } });
    await prisma.faction.create({ data: { code: "LSPD", name: "Los Santos Police Department", guildId: other.id } });
    const leader = "920000000000000301";
    const foreign = "920000000000000302";
    await prisma.discordRole.createMany({
      data: [
        { discordId: leader, guildId: fib.id, name: "Лидер" },
        { discordId: foreign, guildId: other.id, name: "Шеф" },
      ],
    });

    // A role is chosen for the FIB server only.
    await setSetting("vehicleRequests.requesterRoleIds", [leader], context);
    await expect(createVehicleRequest(request, context)).rejects.toThrow(/только выбранным ролям/);
    // A role of another server does not count here, even if the person somehow lists it.
    await expect(createVehicleRequest({ ...request, requesterRoleIds: [foreign] }, context)).rejects.toThrow(/только выбранным ролям/);
    expect((await createVehicleRequest({ ...request, requesterRoleIds: [leader] }, context)).model).toBe("police3");
    // An admin is not held to the list.
    expect((await createVehicleRequest({ ...request, requesterIsAdmin: true }, context)).model).toBe("police3");
    // The LSPD server has no role chosen: the general rule still applies there.
    expect((await createVehicleRequest({ ...request, guildDiscordId: otherId }, context)).factionCodes).toEqual(["LSPD"]);
  });

  it("accepts only models from the list and needs a reason and a time", async () => {
    await factionGuild();
    await setSetting("vehicleRequests.channelId", CHANNEL, context);
    await expect(createVehicleRequest({ ...request, model: "batmobile9000" }, context)).rejects.toThrow(/нет в списке/);
    await expect(createVehicleRequest({ ...request, reason: "   " }, context)).rejects.toThrow();
    await expect(createVehicleRequest({ ...request, time: "" }, context)).rejects.toThrow();
    expect(await prisma.job.count()).toBe(0);
  });
});

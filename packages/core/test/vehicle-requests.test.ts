import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType } from "@mirror/db";
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
  const request = { requesterDiscordId: PLAYER, guildDiscordId: GUILD, model: "Police3", reason: "Патруль на мероприятии", time: "сегодня 20:00 МСК" };

  it("is refused until a channel is chosen in the dashboard", async () => {
    await expect(createVehicleRequest(request, context)).rejects.toThrow(/не настроен/);
    expect(await prisma.job.count()).toBe(0);
  });

  it("queues the message for the admins and writes the journal", async () => {
    await setSetting("vehicleRequests.channelId", CHANNEL, context);
    await setSetting("vehicleRequests.pingRoleIds", [ROLE], context);

    const created = await createVehicleRequest(request, context);
    expect(created).toMatchObject({ model: "police3", category: "Экстренные службы", time: "сегодня 20:00 МСК" });

    const jobs = await prisma.job.findMany({ where: { type: MODULE_JOB_TYPES.VEHICLE_REQUEST_SEND } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({
      requesterDiscordId: PLAYER,
      guildDiscordId: GUILD,
      model: "police3",
      category: "Экстренные службы",
      reason: "Патруль на мероприятии",
      time: "сегодня 20:00 МСК",
    });
    expect(await prisma.auditLog.count({ where: { action: "vehicle_request.created", entityId: jobs[0]?.id ?? "" } })).toBe(1);
  });

  it("accepts only models from the list and needs a reason and a time", async () => {
    await setSetting("vehicleRequests.channelId", CHANNEL, context);
    await expect(createVehicleRequest({ ...request, model: "batmobile9000" }, context)).rejects.toThrow(/нет в списке/);
    await expect(createVehicleRequest({ ...request, reason: "   " }, context)).rejects.toThrow();
    await expect(createVehicleRequest({ ...request, time: "" }, context)).rejects.toThrow();
    expect(await prisma.job.count()).toBe(0);
  });
});

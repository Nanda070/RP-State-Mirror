import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, DecisionStatus, RecordStatus, RegistrationKind } from "@mirror/db";
import {
  MODULE_JOB_TYPES,
  MediaValidationError,
  assertDiscordMediaUrl,
  createCharacter,
  createRegistration,
  decideRegistration,
  expireRegistrations,
  normalizePlate,
  readBodyWithLimit,
  resolveVehicleModelName,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage4.registrations.test" } as const;

async function character(discordId: string) {
  const user = await prisma.user.create({ data: { discordId } });
  return createCharacter({ userId: user.id, slot: 1, staticId: `S-${discordId}`, name: `Driver ${discordId}` }, context);
}

function vehicle(characterId: string, plate: string) {
  return createRegistration(
    { kind: RegistrationKind.VEHICLE, characterId, payload: { model: "Sultan" }, plate },
    context,
  );
}

function streamResponse(chunks: number[], headers: Record<string, string> = {}) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const size = chunks[pulled];
      pulled += 1;
      if (size === undefined) controller.close();
      else controller.enqueue(new Uint8Array(size));
    },
  });
  return { response: new Response(stream, { headers }), pulled: () => pulled };
}

describe("media guards", () => {
  it("accepts only https Discord CDN hosts", () => {
    expect(assertDiscordMediaUrl("https://cdn.discordapp.com/attachments/1/2/a.png").hostname).toBe("cdn.discordapp.com");
    for (const bad of [
      "http://cdn.discordapp.com/a.png",
      "https://evil.example/a.png",
      "https://cdn.discordapp.com.evil.example/a.png",
      "https://169.254.169.254/latest/meta-data",
      "https://cdn.discordapp.com:8443/a.png",
      "not a url",
    ]) {
      expect(() => assertDiscordMediaUrl(bad)).toThrow(MediaValidationError);
    }
  });

  it("aborts streaming once the limit is exceeded without reading the rest", async () => {
    const { response, pulled } = streamResponse([400, 400, 400, 400, 400]);
    await expect(readBodyWithLimit(response, 1000)).rejects.toThrow(/10 МБ/);
    expect(pulled()).toBeLessThan(5);
  });

  it("rejects by declared content-length without buffering the body", async () => {
    const { response, pulled } = streamResponse([10], { "content-length": "5000" });
    await expect(readBodyWithLimit(response, 1000)).rejects.toThrow(/10 МБ/);
    // Response construction may touch the stream once; the body must not be fully pulled.
    expect(pulled()).toBeLessThan(2);
  });

  it("returns the full body under the limit", async () => {
    const { response } = streamResponse([300, 200]);
    expect((await readBodyWithLimit(response, 1000)).byteLength).toBe(500);
  });
});

describe("vehicle registrations", () => {
  it("normalizes plates and rejects a plate held by another active registration", async () => {
    expect(normalizePlate(" a 123 bc ")).toBe("A123BC");
    expect(() => normalizePlate("!")).toThrow(/Госномер/);
    const first = await character("500");
    const second = await character("501");
    const registration = await vehicle(first.id, "a123bc");
    expect(registration.plate).toBe("A123BC");
    await expect(vehicle(second.id, "A 123 BC")).rejects.toThrow(/уже занят/);

    await decideRegistration(registration.id, DecisionStatus.REJECTED, "admin", "нет", context);
    expect((await vehicle(second.id, "A123BC")).plate).toBe("A123BC");
  });

  it("requires a catalog model only when the catalog is not empty", async () => {
    expect(await resolveVehicleModelName("Anything")).toBe("Anything");
    await prisma.vehicleModel.create({ data: { name: "Sultan RS", brand: "Karin" } });
    expect(await resolveVehicleModelName("sultan rs")).toBe("Sultan RS");
    await expect(resolveVehicleModelName("Anything")).rejects.toThrow(/каталоге/);
  });

  it("queues a notification job with every decision", async () => {
    const owner = await character("510");
    const registration = await vehicle(owner.id, "B1");
    await decideRegistration(registration.id, DecisionStatus.REJECTED, "admin", "фото", context);
    const jobs = await prisma.job.findMany({ where: { type: MODULE_JOB_TYPES.REGISTRATION_DECIDED } });
    expect(jobs.map((job) => job.payload)).toEqual([{ registrationId: registration.id }]);
  });

  it("expires approved registrations after the TTL and lets the owner register again", async () => {
    const owner = await character("520");
    const registration = await vehicle(owner.id, "C1");
    const approved = await decideRegistration(registration.id, DecisionStatus.APPROVED, "admin", null, context);
    const ttlMs = (approved.expiresAt?.getTime() ?? 0) - (approved.decidedAt?.getTime() ?? 0);
    expect(Math.round(ttlMs / 86_400_000)).toBe(31);

    expect(await expireRegistrations(new Date())).toBe(0);
    const later = new Date(Date.now() + 32 * 86_400_000);
    expect(await expireRegistrations(later)).toBe(1);
    expect(await expireRegistrations(later)).toBe(0);

    const stored = await prisma.registration.findUniqueOrThrow({ where: { id: registration.id } });
    expect(stored.status).toBe(RecordStatus.EXPIRED);
    expect(await prisma.job.count({ where: { type: MODULE_JOB_TYPES.REGISTRATION_EXPIRED } })).toBe(1);
    expect((await vehicle(owner.id, "C1")).decision).toBe(DecisionStatus.PENDING);
  });
});

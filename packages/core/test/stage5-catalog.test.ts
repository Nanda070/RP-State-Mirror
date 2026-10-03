import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuditActorType, RecordStatus } from "@mirror/db";
import {
  VehicleCatalogError,
  archiveVehicleModel,
  createVehicleModel,
  isVehicleCatalogImage,
  listVehicleBrands,
  listVehicleCatalog,
  sniffImageContentType,
  updateVehicleModel,
} from "@mirror/core";
import { prisma, resetDatabase } from "../../../test/db.js";

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

const context = { actorType: AuditActorType.SYSTEM, source: "stage5.catalog.test" } as const;

async function imageFile(contentType = "image/png") {
  return prisma.mediaFile.create({
    data: { objectKey: `test/${Math.random()}`, originalName: "car.png", contentType, sizeBytes: 10 },
  });
}

describe("vehicle catalog", () => {
  it("creates, lists, filters and archives models with an audit trail", async () => {
    const photo = await imageFile();
    const sultan = await createVehicleModel(
      { name: " Sultan RS ", brand: "Karin", year: 2015, imageFileId: photo.id },
      context,
    );
    await createVehicleModel({ name: "Buffalo", brand: "Bravado" }, context);
    await createVehicleModel({ name: "Kuruma", brand: "Karin", year: null }, context);

    expect(sultan.name).toBe("Sultan RS");
    expect((await listVehicleCatalog()).map((m) => m.name)).toEqual(["Buffalo", "Kuruma", "Sultan RS"]);
    expect((await listVehicleCatalog({ brand: "karin" })).map((m) => m.name)).toEqual(["Kuruma", "Sultan RS"]);
    expect((await listVehicleCatalog({ query: "buff" })).map((m) => m.name)).toEqual(["Buffalo"]);
    expect(await listVehicleBrands()).toEqual(["Bravado", "Karin"]);
    expect(await isVehicleCatalogImage(photo.id)).toBe(true);

    await archiveVehicleModel(sultan.id, context);
    expect((await listVehicleCatalog()).map((m) => m.name)).toEqual(["Buffalo", "Kuruma"]);
    expect(await isVehicleCatalogImage(photo.id)).toBe(false);

    const actions = (await prisma.auditLog.findMany({ where: { entityType: "vehicle_model" } })).map((e) => e.action);
    expect(actions.filter((a) => a === "vehicle_model.created")).toHaveLength(3);
    expect(actions).toContain("vehicle_model.archived");
  });

  it("rejects a duplicate name regardless of case and restores an archived model instead of duplicating", async () => {
    const first = await createVehicleModel({ name: "Elegy", brand: "Annis" }, context);
    await expect(createVehicleModel({ name: "elegy" }, context)).rejects.toBeInstanceOf(VehicleCatalogError);

    await archiveVehicleModel(first.id, context);
    const restored = await createVehicleModel({ name: "ELEGY", brand: "Annis", year: 2017 }, context);
    expect(restored.id).toBe(first.id);
    expect(restored.status).toBe(RecordStatus.ACTIVE);
    expect(restored.year).toBe(2017);
    expect(await prisma.vehicleModel.count()).toBe(1);
  });

  it("updates only the provided fields and guards the name and the photo", async () => {
    const model = await createVehicleModel({ name: "Jester", brand: "Dinka", year: 2014 }, context);
    await createVehicleModel({ name: "Comet" }, context);

    const renamed = await updateVehicleModel(model.id, { name: "Jester Classic" }, context);
    expect(renamed).toMatchObject({ name: "Jester Classic", brand: "Dinka", year: 2014 });

    const cleared = await updateVehicleModel(model.id, { brand: "", year: null }, context);
    expect(cleared).toMatchObject({ brand: null, year: null });

    await expect(updateVehicleModel(model.id, { name: "comet" }, context)).rejects.toBeInstanceOf(VehicleCatalogError);
    await expect(updateVehicleModel(model.id, { imageFileId: "missing" }, context)).rejects.toBeInstanceOf(
      VehicleCatalogError,
    );
    const notImage = await imageFile("application/pdf");
    await expect(updateVehicleModel(model.id, { imageFileId: notImage.id }, context)).rejects.toBeInstanceOf(
      VehicleCatalogError,
    );
  });

  it("rejects an implausible year", async () => {
    await expect(createVehicleModel({ name: "Time Machine", year: 1800 }, context)).rejects.toThrow();
    await expect(
      createVehicleModel({ name: "Time Machine", year: new Date().getFullYear() + 5 }, context),
    ).rejects.toThrow();
  });
});

describe("sniffImageContentType", () => {
  it("recognises image signatures and nothing else", () => {
    expect(sniffImageContentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImageContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageContentType(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    expect(sniffImageContentType(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageContentType(new TextEncoder().encode("RIFF....WAVEfmt "))).toBeNull();
    expect(sniffImageContentType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageContentType(new Uint8Array())).toBeNull();
  });
});

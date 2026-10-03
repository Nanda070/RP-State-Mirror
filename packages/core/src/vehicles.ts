/**
 * Vehicle model catalog (§5.3). Reference only: `/регистрация-тс` keeps a free-text model.
 */
import { RecordStatus, prisma, type Prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";

const CURRENT_YEAR_SLACK = 1;

const vehicleFieldsSchema = z.object({
  name: z.string().trim().min(1, "Укажите название модели").max(128),
  brand: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((value) => value || null),
  year: z
    .number()
    .int()
    .min(1900, "Год не раньше 1900")
    .max(new Date().getFullYear() + CURRENT_YEAR_SLACK, "Год не может быть в будущем")
    .nullish()
    .transform((value) => value ?? null),
  imageFileId: z
    .string()
    .min(1)
    .nullish()
    .transform((value) => value ?? null),
});

export const createVehicleModelSchema = vehicleFieldsSchema;
export const updateVehicleModelSchema = vehicleFieldsSchema.partial();

export type CreateVehicleModelInput = z.input<typeof createVehicleModelSchema>;
export type UpdateVehicleModelInput = z.input<typeof updateVehicleModelSchema>;

export class VehicleCatalogError extends UserError {
  override name = "VehicleCatalogError";
}

export interface VehicleCatalogFilter {
  query?: string | undefined;
  brand?: string | undefined;
}

export async function listVehicleCatalog(filter: VehicleCatalogFilter = {}) {
  const query = filter.query?.trim();
  const brand = filter.brand?.trim();
  return prisma.vehicleModel.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      ...(brand ? { brand: { equals: brand, mode: "insensitive" } } : {}),
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { brand: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ brand: "asc" }, { name: "asc" }],
  });
}

/** Distinct brands of ACTIVE models, alphabetical. */
export async function listVehicleBrands(): Promise<string[]> {
  const rows = await prisma.vehicleModel.findMany({
    where: { status: RecordStatus.ACTIVE, brand: { not: null } },
    distinct: ["brand"],
    select: { brand: true },
    orderBy: { brand: "asc" },
  });
  return rows.map((row) => row.brand).filter((brand): brand is string => Boolean(brand));
}

async function assertImageFile(tx: Prisma.TransactionClient, imageFileId: string | null) {
  if (!imageFileId) return;
  const file = await tx.mediaFile.findFirst({
    where: { id: imageFileId, status: RecordStatus.ACTIVE },
    select: { contentType: true },
  });
  if (!file) throw new VehicleCatalogError("Файл фото не найден.");
  if (!file.contentType.startsWith("image/")) throw new VehicleCatalogError("Фото должно быть изображением.");
}

/** `name` is unique across all statuses, so an archived model with the same name is restored instead. */
export async function createVehicleModel(input: CreateVehicleModelInput, context: AuditContext) {
  const data = createVehicleModelSchema.parse(input);
  return auditedMutation(context, "vehicle_model.created", "vehicle_model", async (tx) => {
    await assertImageFile(tx, data.imageFileId);
    const existing = await tx.vehicleModel.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" } },
    });
    if (existing && existing.status === RecordStatus.ACTIVE) {
      throw new VehicleCatalogError(`Модель «${existing.name}» уже есть в каталоге.`);
    }
    const model = existing
      ? await tx.vehicleModel.update({
          where: { id: existing.id },
          data: { ...data, status: RecordStatus.ACTIVE },
        })
      : await tx.vehicleModel.create({ data });
    return { entityId: model.id, before: existing ?? undefined, after: model, result: model };
  });
}

export async function updateVehicleModel(id: string, input: UpdateVehicleModelInput, context: AuditContext) {
  const data = updateVehicleModelSchema.parse(input);
  return auditedMutation(context, "vehicle_model.updated", "vehicle_model", async (tx) => {
    const current = await tx.vehicleModel.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
    if (!current) throw new VehicleCatalogError("Модель не найдена.");
    if (data.imageFileId !== undefined) await assertImageFile(tx, data.imageFileId);
    if (data.name !== undefined && data.name.toLowerCase() !== current.name.toLowerCase()) {
      const taken = await tx.vehicleModel.findFirst({
        where: { name: { equals: data.name, mode: "insensitive" }, id: { not: id } },
        select: { name: true },
      });
      if (taken) throw new VehicleCatalogError(`Название «${taken.name}» уже занято.`);
    }
    const model = await tx.vehicleModel.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.brand !== undefined ? { brand: data.brand } : {}),
        ...(data.year !== undefined ? { year: data.year } : {}),
        ...(data.imageFileId !== undefined ? { imageFileId: data.imageFileId } : {}),
      },
    });
    return { entityId: id, before: current, after: model, result: model };
  });
}

export async function archiveVehicleModel(id: string, context: AuditContext) {
  return auditedMutation(context, "vehicle_model.archived", "vehicle_model", async (tx) => {
    const current = await tx.vehicleModel.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
    if (!current) throw new VehicleCatalogError("Модель не найдена.");
    const model = await tx.vehicleModel.update({ where: { id }, data: { status: RecordStatus.ARCHIVED } });
    return { entityId: id, before: current, after: model, result: model };
  });
}

/** True when the media file is the photo of an ACTIVE catalog card (readable by any signed-in user). */
export async function isVehicleCatalogImage(mediaFileId: string): Promise<boolean> {
  const model = await prisma.vehicleModel.findFirst({
    where: { imageFileId: mediaFileId, status: RecordStatus.ACTIVE },
    select: { id: true },
  });
  return Boolean(model);
}

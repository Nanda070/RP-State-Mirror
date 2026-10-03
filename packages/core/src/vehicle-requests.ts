/**
 * `/запрос-тс`: a faction member asks the administration to spawn a vehicle.
 *
 * The request is not a registry: it is a message for the admins. It is checked here, written to the
 * audit journal and handed to the job queue; the bot posts it into the channel chosen in the
 * dashboard (Настройки → Модули → Запрос ТС) and pings the roles chosen there.
 *
 * The command works on every faction's Discord server: whoever is on a server tied to a faction may
 * ask. Elsewhere it is for faction members and admins. The admins see which server it came from.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";
import { enqueueJob } from "./jobs.js";
import { MODULE_JOB_TYPES } from "./module-jobs.js";
import { findRageVehicle } from "./rage-vehicles.js";
import { getSetting } from "./settings.js";

const requestSchema = z.object({
  requesterDiscordId: z.string().regex(/^\d{17,20}$/),
  guildDiscordId: z.string().regex(/^\d{17,20}$/).nullable(),
  /** Faction member by roles, or an admin: may ask from any server the bot is on. */
  requesterIsStaff: z.boolean(),
  model: z.string().trim().min(1, "Укажите модель.").max(40),
  reason: z.string().trim().min(1, "Укажите причину.").max(500, "Причина длиннее 500 символов."),
  time: z.string().trim().min(1, "Укажите время.").max(100, "Время длиннее 100 символов."),
});

export type VehicleRequestPayload = {
  requesterDiscordId: string;
  guildDiscordId: string;
  /** Name of the server the request came from, as the bot last saw it. */
  guildName: string;
  /** Factions that server belongs to: «FIB», «GOV»… Empty for a server without a faction. */
  factionCodes: string[];
  model: string;
  category: string;
  reason: string;
  time: string;
};

export async function createVehicleRequest(input: z.input<typeof requestSchema>, context: AuditContext) {
  const data = requestSchema.parse(input);
  const vehicle = findRageVehicle(data.model);
  if (!vehicle) throw new UserError(`Модели «${data.model}» нет в списке. Выберите модель из подсказки.`);
  if (!data.guildDiscordId) throw new UserError("Команда работает только на сервере фракции.");

  const guild = await prisma.guild.findFirst({
    where: { discordId: data.guildDiscordId, status: RecordStatus.ACTIVE },
    select: {
      name: true,
      factions: { where: { status: RecordStatus.ACTIVE }, orderBy: { sortOrder: "asc" }, select: { code: true } },
    },
  });
  const factionCodes = guild?.factions.map((faction) => faction.code) ?? [];
  if (factionCodes.length === 0 && !data.requesterIsStaff) {
    throw new UserError("Запрос транспорта отправляется с сервера фракции.");
  }
  if (!(await getSetting("vehicleRequests.channelId"))) {
    throw new UserError("Канал для запросов ТС не настроен. Сообщите администрации.");
  }

  const payload: VehicleRequestPayload = {
    requesterDiscordId: data.requesterDiscordId,
    guildDiscordId: data.guildDiscordId,
    guildName: guild?.name ?? "сервер не из списка",
    factionCodes,
    model: vehicle.model,
    category: vehicle.category,
    reason: data.reason,
    time: data.time,
  };
  return auditedMutation(context, "vehicle_request.created", "vehicle_request", async (tx) => {
    const job = await enqueueJob({ type: MODULE_JOB_TYPES.VEHICLE_REQUEST_SEND, payload }, tx);
    return { entityId: job.id, after: payload, result: payload };
  });
}

/**
 * `/запрос-тс`: a faction member asks the administration to spawn a vehicle.
 *
 * The request is not a registry: it is a message for the admins. It is checked here, written to the
 * audit journal and handed to the job queue; the bot posts it into the channel chosen in the
 * dashboard (Настройки → Модули → Запрос ТС) and pings the roles chosen there.
 *
 * Who may ask is chosen in the dashboard per server: the roles of that server that are allowed.
 * While no role is chosen for a server, the general rule applies there: on a faction's server —
 * everyone on it, elsewhere — faction members. Admins may always ask. The admins who receive the
 * request see which server it came from.
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
  /** «Админ» and above: always allowed. */
  requesterIsAdmin: z.boolean(),
  /** Faction member by roles, or an admin: the general rule for a server without a faction. */
  requesterIsStaff: z.boolean(),
  /** Roles the person holds on the server the command was used on. */
  requesterRoleIds: z.array(z.string()).max(500),
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

  if (!data.requesterIsAdmin) {
    // Of the roles chosen in the dashboard, those that belong to this server.
    const chosen = await getSetting("vehicleRequests.requesterRoleIds");
    const chosenHere =
      chosen.length > 0
        ? await prisma.discordRole.findMany({
            where: { discordId: { in: chosen }, status: RecordStatus.ACTIVE, guild: { discordId: data.guildDiscordId } },
            select: { discordId: true },
          })
        : [];
    if (chosenHere.length > 0) {
      if (!chosenHere.some((role) => data.requesterRoleIds.includes(role.discordId))) {
        throw new UserError("На этом сервере запрос транспорта доступен только выбранным ролям — у вас такой роли нет.");
      }
    } else if (factionCodes.length === 0 && !data.requesterIsStaff) {
      throw new UserError("Запрос транспорта отправляется с сервера фракции.");
    }
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

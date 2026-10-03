/**
 * `/запрос-тс`: a faction member asks the administration to spawn a vehicle.
 *
 * The request is not a registry: it is a message for the admins. It is checked here, written to the
 * audit journal and handed to the job queue; the bot posts it into the channel chosen in the
 * dashboard (Настройки → Модули → Запрос ТС) and pings the roles chosen there.
 */
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
  model: z.string().trim().min(1, "Укажите модель.").max(40),
  reason: z.string().trim().min(1, "Укажите причину.").max(500, "Причина длиннее 500 символов."),
  time: z.string().trim().min(1, "Укажите время.").max(100, "Время длиннее 100 символов."),
});

export type VehicleRequestPayload = {
  requesterDiscordId: string;
  guildDiscordId: string | null;
  model: string;
  category: string;
  reason: string;
  time: string;
};

export async function createVehicleRequest(input: z.input<typeof requestSchema>, context: AuditContext) {
  const data = requestSchema.parse(input);
  const vehicle = findRageVehicle(data.model);
  if (!vehicle) throw new UserError(`Модели «${data.model}» нет в списке. Выберите модель из подсказки.`);
  if (!(await getSetting("vehicleRequests.channelId"))) {
    throw new UserError("Канал для запросов ТС не настроен. Сообщите администрации.");
  }

  const payload: VehicleRequestPayload = {
    requesterDiscordId: data.requesterDiscordId,
    guildDiscordId: data.guildDiscordId,
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

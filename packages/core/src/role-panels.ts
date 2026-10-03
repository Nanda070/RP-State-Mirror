/**
 * Role panels (§4.14): a bot message that lets members grant themselves roles,
 * either with buttons (toggle one role per button) or with a dropdown.
 * Built from a simple description so the dashboard never assembles the message spec itself.
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import type { EmbedSpec, InteractiveRow, V2Button } from "./embeds.js";
import { SNOWFLAKE_RE } from "./env.js";
import { UserError } from "./errors.js";
import { enqueueRolePanelPublish } from "./module-jobs.js";
import { createRolePanel } from "./stage4.js";

export class RolePanelError extends UserError {
  override name = "RolePanelError";
}

const snowflake = z.string().regex(SNOWFLAKE_RE);
const BUTTONS_PER_ROW = 5;

export const rolePanelInputSchema = z
  .object({
    guildDiscordId: snowflake,
    channelDiscordId: snowflake,
    title: z.string().trim().min(1, "Укажите заголовок").max(256),
    description: z.string().trim().max(4000).nullish(),
    color: z.number().int().min(0).max(0xff_ff_ff).nullish(),
    mode: z.enum(["buttons", "select"]),
    items: z
      .array(
        z.object({
          label: z.string().trim().min(1, "Укажите подпись").max(80),
          roleDiscordId: snowflake,
          style: z.enum(["primary", "secondary", "success", "danger"]).default("secondary"),
          description: z.string().trim().max(100).nullish(),
        }),
      )
      .min(1, "Добавьте хотя бы одну роль")
      .max(25),
    /** Only one role of the panel at a time. */
    exclusive: z.boolean().default(false),
    /** Who may use the panel; empty = everyone. */
    allowedRoleIds: z.array(snowflake).max(25).default([]),
    placeholder: z.string().trim().max(150).nullish(),
  })
  .superRefine((data, ctx) => {
    const roles = data.items.map((item) => item.roleDiscordId);
    if (new Set(roles).size !== roles.length) {
      ctx.addIssue({ code: "custom", message: "Одна роль добавлена дважды.", path: ["items"] });
    }
  });
export type RolePanelInput = z.input<typeof rolePanelInputSchema>;

export function buildRolePanelSpec(input: RolePanelInput): EmbedSpec {
  const data = rolePanelInputSchema.parse(input);
  const roleIds = data.items.map((item) => item.roleDiscordId);
  const restrictions = data.allowedRoleIds.length > 0 ? { allowedRoleIds: data.allowedRoleIds } : {};

  let components: InteractiveRow[];
  if (data.mode === "select") {
    components = [
      {
        type: "role_select",
        placeholder: data.placeholder || (data.exclusive ? "Выберите роль" : "Выберите роли"),
        options: data.items.map((item) => ({
          label: item.label,
          roleDiscordId: item.roleDiscordId,
          ...(item.description ? { description: item.description } : {}),
        })),
        maxValues: data.exclusive ? 1 : data.items.length,
        ...restrictions,
      },
    ];
  } else {
    const buttons: V2Button[] = data.items.map((item) => ({
      type: "button",
      label: item.label,
      style: item.style,
      action: "role.toggle",
      params: {
        roleDiscordId: item.roleDiscordId,
        ...restrictions,
        ...(data.exclusive ? { exclusiveRoleIds: roleIds } : {}),
      },
    }));
    components = [];
    for (let index = 0; index < buttons.length; index += BUTTONS_PER_ROW) {
      components.push({ type: "action_row", components: buttons.slice(index, index + BUTTONS_PER_ROW) });
    }
  }

  return {
    version: 1,
    embeds: [
      {
        type: "embed",
        title: data.title,
        ...(data.description ? { description: data.description } : {}),
        ...(data.color != null ? { color: data.color } : {}),
      },
    ],
    components,
  };
}

/**
 * Creates a panel and queues its publication. Checks against the Discord snapshot that the channel
 * and every role belong to the chosen guild and that the bot can actually hand the roles out.
 */
export async function createRolePanelFromInput(
  input: RolePanelInput,
  createdByDiscordId: string,
  context: AuditContext,
) {
  const data = rolePanelInputSchema.parse(input);
  const guild = await prisma.guild.findFirst({
    where: { discordId: data.guildDiscordId, status: RecordStatus.ACTIVE },
    select: { id: true },
  });
  if (!guild) throw new RolePanelError("Сервер не найден среди подключённых.");
  const channel = await prisma.discordChannel.findFirst({
    where: { discordId: data.channelDiscordId, guildId: guild.id, status: RecordStatus.ACTIVE },
    select: { id: true },
  });
  if (!channel) throw new RolePanelError("Канал не найден на выбранном сервере.");

  const wanted = [...new Set([...data.items.map((item) => item.roleDiscordId), ...data.allowedRoleIds])];
  const roles = await prisma.discordRole.findMany({
    where: { guildId: guild.id, status: RecordStatus.ACTIVE, discordId: { in: wanted } },
    select: { discordId: true, name: true, managed: true },
  });
  const byId = new Map(roles.map((role) => [role.discordId, role]));
  for (const roleId of wanted) {
    if (!byId.has(roleId)) throw new RolePanelError("Одна из ролей не найдена на выбранном сервере.");
  }
  for (const item of data.items) {
    const role = byId.get(item.roleDiscordId);
    if (role?.managed) {
      throw new RolePanelError(`Роль «${role.name}» управляется интеграцией — бот не может её выдавать.`);
    }
    // The @everyone role shares its id with the guild.
    if (item.roleDiscordId === data.guildDiscordId) {
      throw new RolePanelError("Роль @everyone нельзя выдавать панелью.");
    }
  }

  return createRolePanel(
    {
      guildDiscordId: data.guildDiscordId,
      channelDiscordId: data.channelDiscordId,
      spec: buildRolePanelSpec(data),
      createdByDiscordId,
    },
    context,
  );
}

/** Re-sends the panel: the bot edits the existing message or posts a new one if it was deleted. */
export async function republishRolePanel(id: string, context: AuditContext) {
  return auditedMutation(context, "role_panel.republish_queued", "role_panel", async (tx) => {
    const panel = await tx.rolePanel.findFirst({ where: { id, status: RecordStatus.ACTIVE } });
    if (!panel) throw new RolePanelError("Панель не найдена.");
    await enqueueRolePanelPublish(panel.id, tx);
    return { entityId: id, result: panel };
  });
}

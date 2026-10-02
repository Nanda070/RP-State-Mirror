import { RecordStatus, RoleMappingKind, prisma, type RoleMapping } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { snowflakeSchema } from "./env.js";

export const roleMappingInputSchema = z.object({
  guildDiscordId: snowflakeSchema,
  roleDiscordId: snowflakeSchema,
  kind: z.nativeEnum(RoleMappingKind),
  value: z.string().min(1).max(128),
  factionCode: z.string().min(1).max(32).nullable().optional(),
});

export type RoleMappingInput = z.infer<typeof roleMappingInputSchema>;

export class RoleMappingError extends Error {
  override name = "RoleMappingError";
}

function requiresFaction(kind: RoleMappingKind): boolean {
  return (
    kind === RoleMappingKind.FACTION_MEMBER ||
    kind === RoleMappingKind.FACTION_LEADER ||
    kind === RoleMappingKind.FACTION_DEPUTY ||
    kind === RoleMappingKind.DEPARTMENT ||
    kind === RoleMappingKind.RANK
  );
}

async function resolveGuildAndFaction(input: RoleMappingInput) {
  const guild = await prisma.guild.findFirst({
    where: { discordId: input.guildDiscordId, status: RecordStatus.ACTIVE },
  });
  if (!guild) throw new RoleMappingError("Сервер не найден или неактивен");

  const role = await prisma.discordRole.findFirst({
    where: { discordId: input.roleDiscordId, guildId: guild.id, status: RecordStatus.ACTIVE },
  });
  if (!role) throw new RoleMappingError("Роль не найдена на этом сервере");

  let factionId: string | null = null;
  if (input.factionCode) {
    const faction = await prisma.faction.findFirst({
      where: { code: input.factionCode, status: RecordStatus.ACTIVE },
    });
    if (!faction) throw new RoleMappingError("Фракция не найдена");
    factionId = faction.id;
  } else if (requiresFaction(input.kind)) {
    throw new RoleMappingError("Для этого типа привязки нужна фракция");
  }

  if (input.kind === RoleMappingKind.ADMIN_LEVEL) {
    const allowed = new Set(["SUPER_ADMIN", "SENIOR_ADMIN", "ADMIN", "HELPER"]);
    if (!allowed.has(input.value)) {
      throw new RoleMappingError("Некорректный уровень админа");
    }
  }

  if (input.kind === RoleMappingKind.RANK) {
    const rank = Number.parseInt(input.value, 10);
    if (!Number.isFinite(rank) || rank < 1 || rank > 20) {
      throw new RoleMappingError("Ранг должен быть числом от 1 до 20");
    }
  }

  return { guild, role, factionId };
}

export async function listActiveRoleMappings(guildDiscordId?: string) {
  return prisma.roleMapping.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      ...(guildDiscordId
        ? { guild: { discordId: guildDiscordId, status: RecordStatus.ACTIVE } }
        : { guild: { status: RecordStatus.ACTIVE } }),
    },
    include: {
      guild: { select: { discordId: true, name: true } },
      faction: { select: { code: true, name: true } },
    },
    orderBy: [{ kind: "asc" }, { value: "asc" }],
  });
}

export async function upsertRoleMapping(input: RoleMappingInput, context: AuditContext): Promise<RoleMapping> {
  const parsed = roleMappingInputSchema.parse(input);
  const { guild, factionId } = await resolveGuildAndFaction(parsed);

  return auditedMutation(context, "role_mapping.upserted", "role_mapping", async (tx) => {
    const existing = await tx.roleMapping.findUnique({
      where: {
        roleDiscordId_kind_value: {
          roleDiscordId: parsed.roleDiscordId,
          kind: parsed.kind,
          value: parsed.value,
        },
      },
    });

    if (existing) {
      const updated = await tx.roleMapping.update({
        where: { id: existing.id },
        data: {
          guildId: guild.id,
          factionId,
          status: RecordStatus.ACTIVE,
        },
      });
      return { entityId: updated.id, before: existing, after: updated, result: updated };
    }

    const created = await tx.roleMapping.create({
      data: {
        guildId: guild.id,
        roleDiscordId: parsed.roleDiscordId,
        kind: parsed.kind,
        value: parsed.value,
        factionId,
        status: RecordStatus.ACTIVE,
      },
    });
    return { entityId: created.id, after: created, result: created };
  });
}

export async function archiveRoleMapping(id: string, context: AuditContext): Promise<RoleMapping> {
  return auditedMutation(context, "role_mapping.archived", "role_mapping", async (tx) => {
    const existing = await tx.roleMapping.findUnique({ where: { id } });
    if (!existing || existing.status !== RecordStatus.ACTIVE) {
      throw new RoleMappingError("Привязка не найдена");
    }
    const updated = await tx.roleMapping.update({
      where: { id },
      data: { status: RecordStatus.ARCHIVED },
    });
    return { entityId: updated.id, before: existing, after: updated, result: updated };
  });
}

import { AuditActorType, RecordStatus, prisma, type GuildMember } from "@mirror/db";
import { writeAuditEvent, writeAuditEvents, type AuditContext, type AuditEvent } from "./audit.js";

export interface GuildSnapshot {
  discordId: string;
  name: string;
  iconUrl: string | null;
}

export interface RoleSnapshot {
  discordId: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

export interface MemberSnapshot {
  userDiscordId: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  guildAvatarUrl: string | null;
  roleIds: string[];
  joinedAt: Date | null;
}

const DISCORD_CONTEXT: AuditContext = { actorType: AuditActorType.BOT, source: "discord" };

function memberEntityId(guildDiscordId: string, userDiscordId: string) {
  return `${guildDiscordId}:${userDiscordId}`;
}

function sameRoles(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function memberData(snapshot: MemberSnapshot) {
  return {
    username: snapshot.username,
    globalName: snapshot.globalName,
    nickname: snapshot.nickname,
    avatarUrl: snapshot.avatarUrl,
    guildAvatarUrl: snapshot.guildAvatarUrl,
    roleIds: [...snapshot.roleIds].sort(),
    joinedAt: snapshot.joinedAt,
    isPresent: true,
    leftAt: null,
  };
}

async function requireGuild(guildDiscordId: string) {
  const guild = await prisma.guild.findUnique({ where: { discordId: guildDiscordId } });
  if (!guild) throw new Error(`Guild ${guildDiscordId} is not registered; call upsertGuild first`);
  return guild;
}

export async function upsertGuild(snapshot: GuildSnapshot) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.guild.findUnique({ where: { discordId: snapshot.discordId } });
    const guild = await tx.guild.upsert({
      where: { discordId: snapshot.discordId },
      create: { discordId: snapshot.discordId, name: snapshot.name, iconUrl: snapshot.iconUrl },
      update: { name: snapshot.name, iconUrl: snapshot.iconUrl, status: RecordStatus.ACTIVE },
    });
    if (!existing || existing.status !== RecordStatus.ACTIVE) {
      await writeAuditEvent(
        {
          ...DISCORD_CONTEXT,
          guildId: snapshot.discordId,
          action: existing ? "guild.reconnected" : "guild.connected",
          entityType: "guild",
          entityId: snapshot.discordId,
          before: existing ? { status: existing.status } : undefined,
          after: { name: snapshot.name, status: RecordStatus.ACTIVE },
        },
        tx,
      );
    }
    return guild;
  });
}

export async function markGuildUnavailable(guildDiscordId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.guild.findUnique({ where: { discordId: guildDiscordId } });
    if (!existing || existing.status === RecordStatus.ARCHIVED) return;
    await tx.guild.update({ where: { id: existing.id }, data: { status: RecordStatus.ARCHIVED } });
    await writeAuditEvent(
      {
        ...DISCORD_CONTEXT,
        guildId: guildDiscordId,
        action: "guild.disconnected",
        entityType: "guild",
        entityId: guildDiscordId,
        before: { status: existing.status },
        after: { status: RecordStatus.ARCHIVED },
      },
      tx,
    );
  });
}

export async function syncGuildRoles(guildDiscordId: string, roles: RoleSnapshot[]) {
  const guild = await requireGuild(guildDiscordId);
  const initial = guild.lastSyncedAt === null;
  const existing = await prisma.discordRole.findMany({ where: { guildId: guild.id } });
  const existingIds = new Set(existing.filter((r) => r.status === RecordStatus.ACTIVE).map((r) => r.discordId));
  const incomingIds = new Set(roles.map((r) => r.discordId));
  const events: AuditEvent[] = [];

  await prisma.$transaction(async (tx) => {
    for (const role of roles) {
      const data = {
        name: role.name,
        color: role.color,
        position: role.position,
        managed: role.managed,
        status: RecordStatus.ACTIVE,
      };
      await tx.discordRole.upsert({
        where: { discordId: role.discordId },
        create: { discordId: role.discordId, guildId: guild.id, ...data },
        update: data,
      });
      if (!initial && !existingIds.has(role.discordId)) {
        events.push({
          ...DISCORD_CONTEXT,
          guildId: guildDiscordId,
          action: "discord_role.created",
          entityType: "discord_role",
          entityId: role.discordId,
          after: { name: role.name },
        });
      }
    }

    const removed = existing.filter((r) => r.status === RecordStatus.ACTIVE && !incomingIds.has(r.discordId));
    if (removed.length > 0) {
      await tx.discordRole.updateMany({
        where: { id: { in: removed.map((r) => r.id) } },
        data: { status: RecordStatus.ARCHIVED },
      });
      for (const role of removed) {
        events.push({
          ...DISCORD_CONTEXT,
          guildId: guildDiscordId,
          action: "discord_role.deleted",
          entityType: "discord_role",
          entityId: role.discordId,
          before: { name: role.name },
        });
      }
    }
    await writeAuditEvents(events, tx);
  });
}

function membershipChangeEvent(
  guildDiscordId: string,
  existing: GuildMember | undefined,
  snapshot: MemberSnapshot,
): AuditEvent | null {
  const entityId = memberEntityId(guildDiscordId, snapshot.userDiscordId);
  const base = { ...DISCORD_CONTEXT, guildId: guildDiscordId, entityType: "discord_guild_member", entityId };
  if (!existing || !existing.isPresent) {
    return {
      ...base,
      action: "member.joined",
      before: existing ? { isPresent: false, roleIds: existing.roleIds } : undefined,
      after: { isPresent: true, roleIds: snapshot.roleIds },
    };
  }
  if (!sameRoles(existing.roleIds, snapshot.roleIds)) {
    return {
      ...base,
      action: "member.roles_changed",
      before: { roleIds: existing.roleIds },
      after: { roleIds: [...snapshot.roleIds].sort() },
    };
  }
  return null;
}

/** Real-time update from a Discord event. Role and presence changes are audited. */
export async function upsertMember(guildDiscordId: string, snapshot: MemberSnapshot) {
  const guild = await requireGuild(guildDiscordId);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.guildMember.findUnique({
      where: { guildId_userDiscordId: { guildId: guild.id, userDiscordId: snapshot.userDiscordId } },
    });
    await tx.guildMember.upsert({
      where: { guildId_userDiscordId: { guildId: guild.id, userDiscordId: snapshot.userDiscordId } },
      create: { guildId: guild.id, userDiscordId: snapshot.userDiscordId, ...memberData(snapshot) },
      update: memberData(snapshot),
    });
    const event = membershipChangeEvent(guildDiscordId, existing ?? undefined, snapshot);
    if (event) await writeAuditEvent(event, tx);
  });
}

export async function markMemberLeft(guildDiscordId: string, userDiscordId: string) {
  const guild = await prisma.guild.findUnique({ where: { discordId: guildDiscordId } });
  if (!guild) return;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.guildMember.findUnique({
      where: { guildId_userDiscordId: { guildId: guild.id, userDiscordId } },
    });
    if (!existing || !existing.isPresent) return;
    await tx.guildMember.update({ where: { id: existing.id }, data: { isPresent: false, leftAt: new Date() } });
    await writeAuditEvent(
      {
        ...DISCORD_CONTEXT,
        guildId: guildDiscordId,
        action: "member.left",
        entityType: "discord_guild_member",
        entityId: memberEntityId(guildDiscordId, userDiscordId),
        before: { isPresent: true, roleIds: existing.roleIds },
        after: { isPresent: false },
      },
      tx,
    );
  });
}

export interface ReconcileResult {
  created: number;
  updated: number;
  left: number;
  initial: boolean;
}

/**
 * Full snapshot of a guild's members. The very first snapshot of a guild is
 * not audited (it records existing state, not changes); later ones audit diffs.
 */
export async function reconcileGuildMembers(
  guildDiscordId: string,
  members: MemberSnapshot[],
): Promise<ReconcileResult> {
  const guild = await requireGuild(guildDiscordId);
  const initial = guild.lastSyncedAt === null;
  const existing = await prisma.guildMember.findMany({ where: { guildId: guild.id } });
  const byUser = new Map(existing.map((m) => [m.userDiscordId, m]));
  const incoming = new Set(members.map((m) => m.userDiscordId));
  const events: AuditEvent[] = [];
  const toCreate: MemberSnapshot[] = [];
  let updated = 0;

  const left = await prisma.$transaction(
    async (tx) => {
      for (const snapshot of members) {
        const current = byUser.get(snapshot.userDiscordId);
        if (!current) {
          toCreate.push(snapshot);
        } else {
          await tx.guildMember.update({ where: { id: current.id }, data: memberData(snapshot) });
          updated += 1;
        }
        if (!initial) {
          const event = membershipChangeEvent(guildDiscordId, current, snapshot);
          if (event) events.push(event);
        }
      }

      if (toCreate.length > 0) {
        await tx.guildMember.createMany({
          data: toCreate.map((s) => ({ guildId: guild.id, userDiscordId: s.userDiscordId, ...memberData(s) })),
          skipDuplicates: true,
        });
      }

      const departed = existing.filter((m) => m.isPresent && !incoming.has(m.userDiscordId));
      if (departed.length > 0) {
        await tx.guildMember.updateMany({
          where: { id: { in: departed.map((m) => m.id) } },
          data: { isPresent: false, leftAt: new Date() },
        });
        if (!initial) {
          for (const member of departed) {
            events.push({
              ...DISCORD_CONTEXT,
              guildId: guildDiscordId,
              action: "member.left",
              entityType: "discord_guild_member",
              entityId: memberEntityId(guildDiscordId, member.userDiscordId),
              before: { isPresent: true, roleIds: member.roleIds },
              after: { isPresent: false },
            });
          }
        }
      }

      await writeAuditEvents(events, tx);
      await tx.guild.update({ where: { id: guild.id }, data: { lastSyncedAt: new Date() } });
      return departed.length;
    },
    { timeout: 120_000 },
  );

  return { created: toCreate.length, updated, left, initial };
}

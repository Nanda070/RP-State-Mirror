/**
 * Data-erasure requests (the privacy policy, section «Ваши права»).
 *
 * The registries never delete rows, so erasing a person means cutting every link between the rows
 * and the person: the Discord id is replaced by a meaningless pseudonym everywhere it is stored,
 * names, avatars, IP addresses and device strings are cleared, uploaded files are removed from
 * storage. Records themselves (numbers, dates, decisions) stay. In-game data — character names and
 * statics — belongs to the game and is kept.
 */
import { randomBytes } from "node:crypto";
import { Prisma, prisma } from "@mirror/db";
import { z } from "zod";
import { writeAuditEvent, type AuditContext } from "./audit.js";
import { SNOWFLAKE_RE } from "./env.js";
import { UserError } from "./errors.js";
import { eraseMediaFiles } from "./media.js";

export class PrivacyError extends UserError {
  override name = "PrivacyError";
}

export interface AnonymizeResult {
  pseudonym: string;
  /** Rows changed, by table. */
  tables: Record<string, number>;
  filesErased: number;
}

const inputSchema = z.object({
  discordId: z.string().trim().regex(SNOWFLAKE_RE, "Discord ID — это число из 17–20 цифр"),
  requestedByDiscordId: z.string().min(1),
});

export async function anonymizeUser(
  input: z.input<typeof inputSchema>,
  context: AuditContext,
  options: { superAdminUserIds?: readonly string[] } = {},
): Promise<AnonymizeResult> {
  const { discordId, requestedByDiscordId } = inputSchema.parse(input);
  if (discordId === requestedByDiscordId) throw new PrivacyError("Обезличить самого себя нельзя.");
  if (options.superAdminUserIds?.includes(discordId)) {
    throw new PrivacyError("Главного администратора обезличить нельзя: сначала уберите его из SUPER_ADMIN_USER_IDS.");
  }
  // While the person is on a project server, the bot would write their data back with the next snapshot.
  const present = await prisma.guildMember.count({ where: { userDiscordId: discordId, isPresent: true } });
  if (present > 0) {
    throw new PrivacyError(
      `Пользователь состоит на серверах проекта (${present}). Обезличивание возможно после выхода со всех серверов: иначе бот запишет данные заново.`,
    );
  }

  // Files the person attached: collected before the ids are replaced.
  const [registrations, transfers, messages] = await Promise.all([
    prisma.registration.findMany({ where: { applicantDiscordId: discordId }, select: { evidenceFileIds: true } }),
    prisma.transfer.findMany({ where: { createdByDiscordId: discordId }, select: { documentFileIds: true } }),
    prisma.feedbackMessage.findMany({ where: { authorDiscordId: discordId }, select: { attachmentFileIds: true } }),
  ]);
  const fileIds = [
    ...registrations.flatMap((row) => row.evidenceFileIds),
    ...transfers.flatMap((row) => row.documentFileIds),
    ...messages.flatMap((row) => row.attachmentFileIds),
  ];

  const pseudonym = `deleted-${randomBytes(6).toString("hex")}`;
  const tables: Record<string, number> = {};

  await prisma.$transaction(
    async (tx) => {
      // Personal fields that are not ids.
      tables.discord_guild_members_profile = await tx.$executeRaw`
        UPDATE discord_guild_members
        SET username = 'удалён', global_name = NULL, nickname = NULL, avatar_url = NULL,
            guild_avatar_url = NULL, role_ids = '{}', public_flags = NULL, avatar_decoration_url = NULL
        WHERE user_discord_id = ${discordId}`;
      tables.sessions_devices = await tx.$executeRaw`
        UPDATE sessions SET ip_address = NULL, user_agent = NULL, revoked_at = COALESCE(revoked_at, now())
        WHERE discord_id = ${discordId}`;
      tables.personnel_events_names = await tx.$executeRaw`
        UPDATE personnel_events SET subject_name = 'удалён' WHERE subject_discord_id = ${discordId}`;

      // Every column that stores a Discord user id, found by name: new tables are covered automatically.
      const columns = await tx.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'text' AND column_name LIKE '%discord_id'`;
      for (const { table_name: table, column_name: column } of columns) {
        const changed = await tx.$executeRaw(
          Prisma.sql`UPDATE ${Prisma.raw(`"${table}"`)} SET ${Prisma.raw(`"${column}"`)} = ${pseudonym} WHERE ${Prisma.raw(`"${column}"`)} = ${discordId}`,
        );
        if (changed > 0) tables[`${table}.${column}`] = changed;
      }

      // The audit log keeps what happened, but not who: the id inside stored snapshots and the IP go.
      const like = `%${discordId}%`;
      tables.audit_log = await tx.$executeRaw`
        UPDATE audit_log
        SET ip_address = CASE WHEN actor_user_id IN (SELECT id FROM users WHERE discord_id = ${pseudonym}) THEN NULL ELSE ip_address END,
            entity_id = replace(entity_id, ${discordId}, ${pseudonym}),
            metadata = replace(metadata::text, ${discordId}, ${pseudonym})::jsonb,
            before = CASE WHEN before IS NULL THEN NULL ELSE replace(before::text, ${discordId}, ${pseudonym})::jsonb END,
            after = CASE WHEN after IS NULL THEN NULL ELSE replace(after::text, ${discordId}, ${pseudonym})::jsonb END
        WHERE entity_id LIKE ${like} OR metadata::text LIKE ${like} OR before::text LIKE ${like} OR after::text LIKE ${like}
           OR actor_user_id IN (SELECT id FROM users WHERE discord_id = ${pseudonym})`;
      tables.audit_log_archive = await tx.$executeRaw`
        UPDATE audit_log_archive SET payload = replace(payload::text, ${discordId}, ${pseudonym})::jsonb
        WHERE payload::text LIKE ${like}`;
    },
    { timeout: 60_000 },
  );

  const filesErased = await eraseMediaFiles(fileIds);

  // Written after the replacement, so the record of the erasure does not itself contain the id.
  await writeAuditEvent({
    ...context,
    action: "user.anonymized",
    entityType: "user",
    entityId: pseudonym,
    after: { tables, filesErased },
  });
  return { pseudonym, tables, filesErased };
}

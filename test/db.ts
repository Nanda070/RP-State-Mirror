import { prisma } from "@mirror/db";

const TABLES = [
  "share_links",
  "account_recoveries",
  "faq_items",
  "faq_sections",
  "form_ip_bans",
  "form_drafts",
  "form_submissions",
  "form_fields",
  "forms",
  "feedback_messages",
  "feedback_tickets",
  "role_panels",
  "ic_blacklist",
  "webhook_requests",
  "transfers",
  "transfer_rank_rules",
  "registrations",
  "vehicle_models",
  "media_files",
  "tokens",
  "characters",
  "sent_message_links",
  "document_responses",
  "documents",
  "wanteds",
  "fines",
  "personnel_events",
  "button_actions",
  "sent_messages",
  "message_designs",
  "audit_log",
  "audit_log_archive",
  "jobs",
  "role_mappings",
  "discord_guild_members",
  "discord_roles",
  "discord_channels",
  "factions",
  "guilds",
  "system_settings",
  "users",
];

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export { prisma };

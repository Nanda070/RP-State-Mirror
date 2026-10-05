import {
  canManageModules,
  canManageSystemSettings,
  canViewModules,
  getFeedbackAttachmentInfo,
  getSetting,
  listFeedbackTickets,
  listStaffDiscordIds,
} from "@mirror/core";
import { redirect } from "next/navigation";
import { FeedbackInbox } from "@/components/feedback-inbox";
import { FeedbackPublish } from "@/components/feedback-publish";
import { getDashboardEnv } from "@/env";
import { getActiveChannelOptions, getActiveGuildOptions } from "@/lib/catalog";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";
import { ticketFiles } from "@/lib/ticket-files";

export const metadata = { title: "Обратная связь" };

export default async function FeedbackPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const canPublish = canManageSystemSettings(identity);
  const canAct = canManageModules(identity);
  const tickets = await listFeedbackTickets();
  const files = await getFeedbackAttachmentInfo(
    tickets.flatMap((ticket) => ticket.messages.flatMap((message) => message.attachmentFileIds)),
  );
  const staffDiscordIds = canAct
    ? await listStaffDiscordIds(getDashboardEnv().SUPER_ADMIN_USER_IDS)
    : [];
  const staffAssignable = (
    await Promise.all(
      staffDiscordIds.map(async (discordId) =>
        canManageModules(await resolveFreshIdentity(discordId)) ? discordId : null,
      ),
    )
  ).filter((id): id is string => id !== null);

  const authorLabels = await resolveAuthorLabels([
    session.user.discordId,
    ...staffAssignable,
    ...tickets.flatMap((ticket) => [
      ticket.authorDiscordId,
      ...(ticket.assignedToDiscordId ? [ticket.assignedToDiscordId] : []),
      ...ticket.messages.map((m) => m.authorDiscordId),
    ]),
  ]);
  const label = (id: string) => authorLabels.get(id) ?? id;
  const staffOptions = staffAssignable
    .map((discordId) => ({ discordId, label: label(discordId) }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));

  const [channels, guilds, openMessage] = canPublish
    ? await Promise.all([
        getActiveChannelOptions(),
        getActiveGuildOptions(),
        getSetting("feedback.openMessage"),
      ])
    : [[], [], null];

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Обратная связь</h1>
        <p className="muted">Обращения из Discord: {tickets.length.toLocaleString("ru-RU")}</p>
      </div>

      {canPublish ? (
        <FeedbackPublish
          guilds={guilds.map((g) => ({ discordId: g.discordId, name: g.name }))}
          channels={channels.map((c) => ({
            discordId: c.discordId,
            name: c.name,
            guildDiscordId: c.guild.discordId,
            guildName: c.guild.name,
          }))}
          initialOpenMessage={openMessage}
        />
      ) : null}

      <FeedbackInbox
        canReply={canAct}
        canAssign={canAct}
        staffOptions={staffOptions}
        replyAuthorLabel={label(session.user.discordId)}
        initial={tickets.map((ticket) => ({
          id: ticket.id,
          category: ticket.category,
          status: ticket.status,
          authorLabel: label(ticket.authorDiscordId),
          createdAt: formatMoscowShort(ticket.createdAt),
          assignedToDiscordId: ticket.assignedToDiscordId,
          assignedLabel: ticket.assignedToDiscordId ? label(ticket.assignedToDiscordId) : null,
          messages: ticket.messages.map((m) => ({
            authorLabel: label(m.authorDiscordId),
            content: m.content,
            at: formatMoscowShort(m.createdAt),
            files: ticketFiles(m.attachmentFileIds, files),
          })),
        }))}
      />
    </div>
  );
}

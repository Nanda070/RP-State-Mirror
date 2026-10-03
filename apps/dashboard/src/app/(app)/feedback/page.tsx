import {
  canManageSystemSettings,
  canViewModules,
  getSetting,
  listFeedbackTickets,
} from "@mirror/core";
import { redirect } from "next/navigation";
import { FeedbackInbox } from "@/components/feedback-inbox";
import { FeedbackPublish } from "@/components/feedback-publish";
import { getActiveChannelOptions, getActiveGuildOptions } from "@/lib/catalog";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Обратная связь" };

export default async function FeedbackPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const canPublish = canManageSystemSettings(identity);
  const tickets = await listFeedbackTickets();
  const canReply = canPublish;
  const authorLabels = await resolveAuthorLabels([
    session.user.discordId,
    ...tickets.flatMap((ticket) => [ticket.authorDiscordId, ...ticket.messages.map((m) => m.authorDiscordId)]),
  ]);
  const label = (id: string) => authorLabels.get(id) ?? id;

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
        canReply={canReply}
        replyAuthorLabel={label(session.user.discordId)}
        initial={tickets.map((ticket) => ({
          id: ticket.id,
          category: ticket.category,
          status: ticket.status,
          authorLabel: label(ticket.authorDiscordId),
          createdAt: formatMoscowShort(ticket.createdAt),
          messages: ticket.messages.map((m) => ({
            authorLabel: label(m.authorDiscordId),
            content: m.content,
            at: formatMoscowShort(m.createdAt),
          })),
        }))}
      />
    </div>
  );
}

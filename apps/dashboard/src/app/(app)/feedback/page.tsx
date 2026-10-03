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
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export default async function FeedbackPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const canPublish = canManageSystemSettings(identity);
  const tickets = await listFeedbackTickets();
  const canReply = canPublish;

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
        <p className="muted">
          Тикеты из Discord. Всего: {tickets.length.toLocaleString("ru-RU")}.
          {canReply ? " Ответ уходит игроку в ЛС." : null}
        </p>
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
        initial={tickets.map((ticket) => ({
          id: ticket.id,
          category: ticket.category,
          status: ticket.status,
          authorDiscordId: ticket.authorDiscordId,
          messages: ticket.messages.map((m) => ({
            authorDiscordId: m.authorDiscordId,
            content: m.content,
          })),
        }))}
      />
    </div>
  );
}

import {
  canManageSystemSettings,
  canViewModules,
  listFeedbackTickets,
} from "@mirror/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeedbackInbox } from "@/components/feedback-inbox";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export default async function FeedbackPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const tickets = await listFeedbackTickets();
  const canReply = canManageSystemSettings(identity);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Обратная связь</h1>
        <p className="muted">
          Тикеты из Discord. Всего: {tickets.length.toLocaleString("ru-RU")}.
          {canReply
            ? " Ответ уходит игроку в ЛС."
            : " Ответы доступны главному администратору."}
        </p>
      </div>

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

      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Канал уведомлений — в{" "}
        <Link href="/settings/stage4?tab=feedback">конфигурации модулей</Link> (главный
        администратор).
      </p>
    </div>
  );
}

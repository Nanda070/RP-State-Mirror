import { getSetting, listOwnFeedbackTickets } from "@mirror/core";
import { SupportDesk } from "@/components/support-desk";
import { formatMoscowShort } from "@/lib/moscow";
import { requireSignedIn } from "@/lib/session";

export const metadata = { title: "Мои обращения" };

export default async function SupportPage() {
  const session = await requireSignedIn();
  const me = session.user.discordId;
  const [tickets, categories] = await Promise.all([listOwnFeedbackTickets(me), getSetting("feedback.categories")]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Мои обращения</h1>
        <p className="muted">Ответ администрации придёт сюда и в личные сообщения Discord.</p>
      </div>
      <SupportDesk
        categories={categories}
        tickets={tickets.map((ticket) => ({
          id: ticket.id,
          category: ticket.category,
          status: ticket.status,
          createdAt: formatMoscowShort(ticket.createdAt),
          messages: ticket.messages.map((message) => ({
            mine: message.authorDiscordId === me,
            content: message.content,
            at: formatMoscowShort(message.createdAt),
          })),
        }))}
      />
    </div>
  );
}

import {
  buildStatusBadge,
  canManageSystemSettings,
  canViewModules,
  getPlayerProfile,
} from "@mirror/core";
import { DecisionStatus, FeedbackTicketStatus, RecordStatus, TransferStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Главная" };

const count = (value: number) => new Intl.NumberFormat("ru-RU").format(value);

const MODULE_LINKS = [
  { label: "Документы", href: "/documents" },
  { label: "Розыск", href: "/wanted" },
  { label: "Штрафы", href: "/fines" },
  { label: "Персонал", href: "/personnel" },
  { label: "Регистрации ТС", href: "/registrations/vehicles" },
  { label: "Регистрации форм", href: "/registrations/uniforms" },
  { label: "Переводы", href: "/transfers" },
  { label: "Нашивки", href: "/tokens" },
  { label: "IC ЧС", href: "/ic-blacklist" },
  { label: "Эмбеды", href: "/settings/embeds" },
  { label: "Формы", href: "/settings/forms" },
  { label: "Кнопки и роли", href: "/settings/buttons" },
  { label: "Обратная связь", href: "/feedback" },
] as const;

type Metric = { label: string; value: number; hint: string; href: string; alert?: boolean };

function Metrics({ items }: { items: Metric[] }) {
  return (
    <div className="metric-grid">
      {items.map((item) => (
        <Link key={item.label} href={item.href} className="metric-card" data-alert={item.alert && item.value > 0 ? "" : undefined}>
          <span className="metric-label">{item.label}</span>
          <span className="metric-value">{count(item.value)}</span>
          <span className="metric-hint">{item.hint}</span>
        </Link>
      ))}
    </div>
  );
}

export default async function OverviewPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  const badge = buildStatusBadge(identity);
  const isStaff = canViewModules(identity);
  const displayName = session.user.name ?? session.user.username ?? "пользователь";

  return (
    <div className="stack overview-page">
      <div className="section-head">
        <h1>Добро пожаловать, {displayName}</h1>
        <p className="muted">{[badge.primary, badge.secondary].filter(Boolean).join(" · ")}</p>
      </div>
      {isStaff ? <StaffOverview showModules={canManageSystemSettings(identity)} /> : <PlayerOverview discordId={session.user.discordId} />}
    </div>
  );
}

/** What waits for a decision, and — for the super admin — shortcuts to the modules. */
async function StaffOverview({ showModules }: { showModules: boolean }) {
  const pending = { decision: DecisionStatus.PENDING, status: RecordStatus.ACTIVE };
  const now = new Date();
  const [vehicles, uniforms, transfers, tickets, wanted, fines, overdue] = await Promise.all([
    prisma.registration.count({ where: { ...pending, kind: "VEHICLE" } }),
    prisma.registration.count({ where: { ...pending, kind: "UNIFORM" } }),
    prisma.transfer.count({ where: { status: TransferStatus.PENDING } }),
    prisma.feedbackTicket.count({ where: { status: { in: [FeedbackTicketStatus.OPEN, FeedbackTicketStatus.IN_PROGRESS] } } }),
    prisma.wanted.count({ where: { status: RecordStatus.ACTIVE } }),
    prisma.fine.count({ where: { status: RecordStatus.ACTIVE } }),
    prisma.fine.count({ where: { status: RecordStatus.ACTIVE, dueAt: { lte: now } } }),
  ]);

  return (
    <>
      <section className="stack-tight">
        <h2 className="panel-title">Ждёт решения</h2>
        <Metrics
          items={[
            { label: "Регистрации ТС", value: vehicles, hint: "заявок на рассмотрении", href: "/registrations/vehicles?status=PENDING", alert: true },
            { label: "Регистрации форм", value: uniforms, hint: "заявок на рассмотрении", href: "/registrations/uniforms?status=PENDING", alert: true },
            { label: "Переводы", value: transfers, hint: "ждут решения сторон", href: "/transfers?status=PENDING", alert: true },
            { label: "Обращения", value: tickets, hint: "открыто", href: "/feedback", alert: true },
          ]}
        />
      </section>
      <section className="stack-tight">
        <h2 className="panel-title">Реестры</h2>
        <Metrics
          items={[
            { label: "В розыске", value: wanted, hint: "активных ордеров", href: "/wanted?status=ACTIVE" },
            { label: "Неоплаченные штрафы", value: fines, hint: "всего", href: "/fines?status=ACTIVE" },
            { label: "Просроченные штрафы", value: overdue, hint: "срок оплаты истёк", href: "/fines?status=OVERDUE", alert: true },
          ]}
        />
      </section>
      {showModules ? (
        <section className="panel">
          <h2 className="panel-title">Модули</h2>
          <div className="module-chip-row">
            {MODULE_LINKS.map((item) => (
              <Link key={item.href} href={item.href} className="module-chip">
                {item.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

async function PlayerOverview({ discordId }: { discordId: string }) {
  const profile = await getPlayerProfile(discordId);
  const unpaid = profile.fines.filter((fine) => fine.status === RecordStatus.ACTIVE).length;
  const wanted = profile.wanted.filter((row) => row.status === RecordStatus.ACTIVE).length;
  const pending = profile.registrations.filter(
    (row) => row.decision === DecisionStatus.PENDING && row.status === RecordStatus.ACTIVE,
  ).length;

  return (
    <>
      <Metrics
        items={[
          { label: "Персонажи", value: profile.characters.length, hint: "из трёх возможных", href: "/profile?tab=characters" },
          { label: "Заявки", value: pending, hint: "на рассмотрении", href: "/profile?tab=registrations" },
          { label: "Неоплаченные штрафы", value: unpaid, hint: "по вашим персонажам", href: "/profile?tab=records", alert: true },
          { label: "Розыск", value: wanted, hint: wanted > 0 ? "активных ордеров" : "не в розыске", href: "/profile?tab=records", alert: true },
        ]}
      />
      <section className="panel">
        <h2 className="panel-title">Разделы</h2>
        <div className="player-sections">
          <Link href="/catalog" className="player-section">
            <strong>Каталог ТС</strong>
            <span className="muted">Модели транспорта с фото.</span>
          </Link>
          <Link href="/calculator" className="player-section">
            <strong>Калькулятор переводов</strong>
            <span className="muted">Какой ранг вы получите в другой фракции.</span>
          </Link>
          <Link href="/faq" className="player-section">
            <strong>FAQ</strong>
            <span className="muted">Команды бота и ответы на частые вопросы.</span>
          </Link>
          <Link href="/ic-blacklist" className="player-section">
            <strong>IC чёрный список</strong>
            <span className="muted">Реестр записей.</span>
          </Link>
        </div>
      </section>
    </>
  );
}

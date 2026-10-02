import { canManageSystemSettings, getSetting, listActiveRoleMappings } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { resolveFreshIdentity } from "@/lib/session";

type ModuleCard = {
  href: string;
  title: string;
  description: string;
  status: "ready" | "soon";
  meta?: string;
};

export default async function SettingsIndexPage() {
  const session = await auth();
  if (!session?.user?.discordId) redirect("/");
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageSystemSettings(identity)) redirect("/overview");

  const [guildCount, mainGuildId, incidentGuildId, mappings] = await Promise.all([
    prisma.guild.count({ where: { status: RecordStatus.ACTIVE } }),
    getSetting("core.mainGuildId"),
    getSetting("core.incidentGuildId"),
    listActiveRoleMappings(),
  ]);

  const core: ModuleCard[] = [
    {
      href: "/settings/system",
      title: "Система",
      description: "Главный сервер и сервер ЧП — ядро доступа и синхронизации.",
      status: "ready",
      meta: `Серверов: ${guildCount} · Главный: ${mainGuildId ? "задан" : "нет"} · ЧП: ${incidentGuildId ? "задан" : "нет"}`,
    },
    {
      href: "/settings/roles",
      title: "Роли",
      description: "Привязка Discord-ролей к уровням доступа и фракциям.",
      status: "ready",
      meta: `Активных привязок: ${mappings.length}`,
    },
  ];

  const modules: ModuleCard[] = [
    {
      href: "/settings/documents",
      title: "Документы",
      description: "Отправка документов и реестр. Без шаблонов и генерации.",
      status: "soon",
    },
    {
      href: "/settings/wanted",
      title: "Розыск",
      description: "Списки розыска и синхронизация с сервером ЧП.",
      status: "soon",
    },
    {
      href: "/settings/fines",
      title: "Штрафы",
      description: "Штрафы, тарифы и журнал взысканий.",
      status: "soon",
    },
    {
      href: "/settings/tokens",
      title: "Токены",
      description: "Служебные токены и интеграции бота.",
      status: "soon",
    },
    {
      href: "/settings/registrations",
      title: "Регистрации",
      description: "Регистрации персонажей и проверки на ЧП.",
      status: "soon",
    },
    {
      href: "/settings/embeds",
      title: "Эмбеды",
      description: "Шаблоны Discord-эмбедов для модулей бота.",
      status: "soon",
    },
  ];

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Настройки</h1>
      </div>

      <section className="stack" style={{ gap: "0.75rem" }}>
        <h2 className="panel-title" style={{ margin: 0 }}>
          Ядро
        </h2>
        <div className="settings-hub-grid">
          {core.map((card) => (
            <Link key={card.href} href={card.href} className="settings-hub-card">
              <div className="settings-hub-card-top">
                <h3>{card.title}</h3>
                <span className="stub-badge" data-ready>
                  Готово
                </span>
              </div>
              <p className="muted">{card.description}</p>
              {card.meta ? <p className="settings-hub-meta">{card.meta}</p> : null}
            </Link>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: "0.75rem" }}>
        <h2 className="panel-title" style={{ margin: 0 }}>
          Модули бота
        </h2>
        <div className="settings-hub-grid">
          {modules.map((card) => (
            <Link key={card.href} href={card.href} className="settings-hub-card">
              <div className="settings-hub-card-top">
                <h3>{card.title}</h3>
                <span className="stub-badge">Скоро</span>
              </div>
              <p className="muted">{card.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

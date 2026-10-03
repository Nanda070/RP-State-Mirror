import { getSettings, listActiveRoleMappings } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { requireSystemSettingsPage } from "@/lib/session";

type ModuleCard = {
  href: string;
  title: string;
  description: string;
  status: "ready" | "soon";
  meta?: string;
};

export default async function SettingsIndexPage() {
  await requireSystemSettingsPage();

  const [counts, settings, mappings] = await Promise.all([
    Promise.all([
      prisma.guild.count({ where: { status: RecordStatus.ACTIVE } }),
      prisma.document.count(),
      prisma.wanted.count(),
      prisma.fine.count(),
      prisma.personnelEvent.count(),
      prisma.messageDesign.count({ where: { status: RecordStatus.ACTIVE } }),
      prisma.faction.count({ where: { status: RecordStatus.ACTIVE } }),
    ]),
    getSettings([
      "core.mainGuildId",
      "core.incidentGuildId",
      "wanted.channelId",
      "fines.channelId",
      "cp.syncEnabled",
    ] as const),
    listActiveRoleMappings(),
  ]);

  const [
    guildCount,
    docCount,
    wantedCount,
    fineCount,
    personnelCount,
    designCount,
    factionCount,
  ] = counts;

  const mainGuildId = settings["core.mainGuildId"];
  const incidentGuildId = settings["core.incidentGuildId"];
  const wantedChannelId = settings["wanted.channelId"];
  const finesChannelId = settings["fines.channelId"];
  const cpSyncEnabled = settings["cp.syncEnabled"];

  const core: ModuleCard[] = [
    {
      href: "/settings/system",
      title: "Система",
      description: "Главный сервер, сервер ЧП и синхронизация ролей.",
      status: "ready",
      meta: `Серверов: ${guildCount} · ЧП sync: ${cpSyncEnabled ? "вкл" : "выкл"} · Главный: ${mainGuildId ? "задан" : "нет"} · ЧП: ${incidentGuildId ? "задан" : "нет"}`,
    },
    {
      href: "/settings/roles",
      title: "Роли",
      description: "Привязка Discord-ролей к уровням доступа и фракциям.",
      status: "ready",
      meta: `Активных привязок: ${mappings.length}`,
    },
    {
      href: "/settings/factions",
      title: "Фракции",
      description: "Каналы и вебхуки документов / кадрового аудита.",
      status: "ready",
      meta: `Фракций: ${factionCount}`,
    },
  ];

  const modules: ModuleCard[] = [
    {
      href: "/settings/documents",
      title: "Документы",
      description: "Отправка документов и реестр. Без шаблонов и генерации.",
      status: "ready",
      meta: `Реестр: ${docCount} · /documents`,
    },
    {
      href: "/settings/wanted",
      title: "Розыск",
      description: "Федеральный розыск, канал ЧП и реестр.",
      status: "ready",
      meta: `Реестр: ${wantedCount} · канал: ${wantedChannelId ? "задан" : "нет"}`,
    },
    {
      href: "/settings/fines",
      title: "Штрафы",
      description: "Штрафы, срок оплаты, канал ЧП и реестр.",
      status: "ready",
      meta: `Реестр: ${fineCount} · канал: ${finesChannelId ? "задан" : "нет"}`,
    },
    {
      href: "/settings/embeds",
      title: "Эмбеды",
      description: "Конструктор Classic/V2, превью и отправка.",
      status: "ready",
      meta: `Дизайнов: ${designCount}`,
    },
    {
      href: "/settings/forms",
      title: "Discord-формы",
      description: "Создание modal-форм и доставка ответов.",
      status: "ready",
      meta: "Администрирование",
    },
    {
      href: "/settings/webhooks",
      title: "Webhooks",
      description: "Очередь запросов /создать-webhook.",
      status: "ready",
      meta: "Администрирование",
    },
    {
      href: "/settings/stage4",
      title: "Конфигурация модулей",
      description: "Каналы и роли: регистрации, переводы, IC ЧС, токены, инвайты, уведомления.",
      status: "ready",
      meta: "Вкладки по модулям",
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
        <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <Link href="/documents" className="btn btn-secondary">
            Реестр документов
          </Link>
          <Link href="/wanted" className="btn btn-secondary">
            Реестр розыска
          </Link>
          <Link href="/fines" className="btn btn-secondary">
            Реестр штрафов
          </Link>
          <Link href="/personnel" className="btn btn-secondary">
            Реестр персонала ({personnelCount})
          </Link>
          <Link href="/registrations/vehicles" className="btn btn-secondary">
            Регистрации ТС
          </Link>
          <Link href="/registrations/uniforms" className="btn btn-secondary">
            Регистрации форм
          </Link>
          <Link href="/ic-blacklist" className="btn btn-secondary">
            IC ЧС реестр
          </Link>
          <Link href="/feedback" className="btn btn-secondary">
            Обратная связь
          </Link>
        </div>
        <div className="settings-hub-grid">
          {modules.map((card) => (
            <Link key={card.href} href={card.href} className="settings-hub-card">
              <div className="settings-hub-card-top">
                <h3>{card.title}</h3>
                {card.status === "ready" ? (
                  <span className="stub-badge" data-ready>
                    Готово
                  </span>
                ) : (
                  <span className="stub-badge">Скоро</span>
                )}
              </div>
              <p className="muted">{card.description}</p>
              {card.meta ? <p className="settings-hub-meta">{card.meta}</p> : null}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

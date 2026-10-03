import { getSetting } from "@mirror/core";
import { RecordStatus, prisma } from "@mirror/db";
import Link from "next/link";
import { SettingsDocumentsForm } from "@/components/settings-module-form";
import { requireSystemSettingsPage } from "@/lib/session";

export default async function SettingsDocumentsPage() {
  await requireSystemSettingsPage();

  const [ttlHours, docCount, factionsWithChannel] = await Promise.all([
    getSetting("documents.ttlHours"),
    prisma.document.count(),
    prisma.faction.findMany({
      where: { status: RecordStatus.ACTIVE },
      orderBy: { sortOrder: "asc" },
      select: { code: true, name: true, settings: true, guildId: true },
    }),
  ]);

  const channelReady = factionsWithChannel.filter((f) => {
    const s = f.settings as { documentsChannelId?: string; documentsWebhookUrl?: string } | null;
    return Boolean(s?.documentsChannelId || s?.documentsWebhookUrl);
  }).length;

  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>Документы</span>
        </p>
        <h1>Документы</h1>
        <p className="muted">
          Отправка через <code>/пост</code> и <code>/ответ</code>, реестр и TTL. Шаблоны и генерация
          бланков не входят в модуль.
        </p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <span className="stub-badge" data-ready>
            Готово
          </span>
          <Link href="/documents" className="btn btn-secondary">
            Открыть реестр
          </Link>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title" style={{ marginTop: 0 }}>
          Состояние
        </h2>
        <ul className="status-list">
          <li>
            <span className="status-dot" data-ok />
            Записей в реестре
            <strong>{docCount.toLocaleString("ru-RU")}</strong>
          </li>
          <li>
            <span className="status-dot" data-ok={channelReady > 0} />
            Фракции с каналом/вебхуком документов
            <strong>
              {channelReady} / {factionsWithChannel.length}
            </strong>
          </li>
        </ul>
        <p className="muted" style={{ marginBottom: 0, fontSize: "0.85rem" }}>
          Канал документов задаётся в <code>faction.settings.documentsChannelId</code> (или webhook
          URL). Пока нет UI редактора фракций — значение правится через сид/БД.
        </p>
      </div>

      <SettingsDocumentsForm initialTtlHours={ttlHours} />
    </div>
  );
}

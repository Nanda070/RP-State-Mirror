import Link from "next/link";

export function SettingsModuleStub({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="stack">
      <div className="section-head">
        <p className="crumb-inline muted">
          <Link href="/settings">Настройки</Link>
          <span aria-hidden> › </span>
          <span>{title}</span>
        </p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      <div className="panel stub-panel">
        <div className="stub-badge">Скоро</div>
        <h2 className="panel-title">Модуль в разработке</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          Настройки этого модуля будут жить на этой странице — отдельно от системных параметров и
          других модулей. Пока доступны только каркас маршрута и описание.
        </p>
        <div className="row" style={{ marginTop: "1rem" }}>
          <Link href="/settings" className="btn btn-secondary">
            К списку модулей
          </Link>
        </div>
      </div>
    </div>
  );
}

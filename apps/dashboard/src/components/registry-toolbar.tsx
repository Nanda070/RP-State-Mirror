import Link from "next/link";

export type RegistrySearch = { q?: string; status?: string; page?: string };

/** Query of a registry page as the listing functions take it. */
export function registryQuery(params: RegistrySearch) {
  const page = Number(params.page);
  return {
    q: params.q?.trim() || undefined,
    status: params.status?.trim() || undefined,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

function href(path: string, params: Record<string, string | undefined>, page?: number) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  if (page && page > 1) search.set("page", String(page));
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

/**
 * Search field and status filter above a registry table. A plain GET form: works without scripts,
 * the address can be copied to share a filtered view.
 */
export function RegistryToolbar({
  path,
  query,
  statuses,
  placeholder,
  exportRegistry,
  children,
}: {
  path: string;
  query: { q?: string | undefined; status?: string | undefined };
  /** Status filter options: value → label. */
  statuses?: Record<string, string>;
  placeholder: string;
  /** Registry key for «Скачать CSV». */
  exportRegistry?: string;
  /** Extra fields of the form (the audit log has more filters). */
  children?: React.ReactNode;
}) {
  const filtered = Boolean(query.q || query.status);
  return (
    <form className="registry-toolbar" action={path} method="get" role="search">
      <div className="field registry-toolbar-search">
        <label htmlFor="registry-q">Поиск</label>
        <input id="registry-q" name="q" type="search" defaultValue={query.q ?? ""} placeholder={placeholder} />
      </div>
      {statuses ? (
        <div className="field">
          <label htmlFor="registry-status">Статус</label>
          <select id="registry-status" name="status" defaultValue={query.status ?? ""}>
            <option value="">Все</option>
            {Object.entries(statuses).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {children}
      <div className="registry-toolbar-buttons">
        <button type="submit" className="btn btn-primary">
          Найти
        </button>
        {filtered ? (
          <Link href={path} className="btn btn-secondary">
            Сбросить
          </Link>
        ) : null}
        {exportRegistry ? (
          <a className="btn btn-secondary" href={`/api/export/${exportRegistry}`} download>
            Скачать CSV
          </a>
        ) : null}
      </div>
    </form>
  );
}

export function Pager({
  path,
  params,
  page,
  pages,
  total,
}: {
  path: string;
  params: Record<string, string | undefined>;
  page: number;
  pages: number;
  total: number;
}) {
  if (pages <= 1) {
    return <p className="registry-total muted">Найдено: {total.toLocaleString("ru-RU")}</p>;
  }
  return (
    <nav className="registry-pager" aria-label="Страницы">
      <span className="muted">
        Найдено: {total.toLocaleString("ru-RU")} · страница {page} из {pages}
      </span>
      <span className="registry-pager-links">
        {page > 1 ? (
          <Link className="btn btn-secondary" href={href(path, params, page - 1)} rel="prev">
            ← Назад
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="btn btn-secondary" href={href(path, params, page + 1)} rel="next">
            Вперёд →
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

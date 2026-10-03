import type { CSSProperties, ReactNode } from "react";

/**
 * Small display pieces shared by pages. No hooks and no server-only imports here:
 * both server pages and client components render them.
 */

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

type EmptyIcon = "search" | "inbox" | "car" | "form";

function EmptyGlyph({ icon }: { icon: EmptyIcon }) {
  switch (icon) {
    case "inbox":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
          <path d="M4 13.5 6.5 6h11L20 13.5V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4.5Z" {...stroke} />
          <path d="M4 13.5h4.5l1 2h5l1-2H20" {...stroke} />
        </svg>
      );
    case "car":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
          <path d="M4 15.5v-3l2-4.5h12l2 4.500v3M4 15.5h16M4 15.5V17h2.500v-1.500M20 15.5V17h-2.500v-1.500M6.5 12h11" {...stroke} />
        </svg>
      );
    case "form":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
          <rect x="5.5" y="4.5" width="13" height="15" rx="1.5" {...stroke} />
          <path d="M9 9h6M9 12.500h6M9 16h3" {...stroke} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="5.5" {...stroke} />
          <path d="M15.5 15.5 20 20" {...stroke} />
        </svg>
      );
  }
}

/** The one empty state: an icon, what is missing, and — when there is one — the way out. */
export function EmptyState({
  title,
  text,
  action,
  icon = "search",
}: {
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  icon?: EmptyIcon;
}) {
  return (
    <div className="empty" role="status">
      <span className="empty-icon">
        <EmptyGlyph icon={icon} />
      </span>
      <p className="empty-title">{title}</p>
      {text ? <p className="empty-text">{text}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/** Vehicle plate drawn as a San Andreas licence plate. */
export function Plate({ value }: { value: string | null | undefined }) {
  return value ? <span className="plate">{value}</span> : <>—</>;
}

/** A sum of money: `due` — still to pay, `paid` — settled, `void` — cancelled. */
export function Money({ children, state }: { children: ReactNode; state?: "due" | "paid" | "void" }) {
  return (
    <span className="money" data-state={state}>
      {children}
    </span>
  );
}

/** Document status as a rubber stamp. */
export function Stamp({ children, status }: { children: ReactNode; status: "ok" | "warn" | "bad" | "info" | "muted" }) {
  return (
    <span className="stamp" data-status={status}>
      {children}
    </span>
  );
}

/** Federal wanted is the top level: five stars, lit while the search is on. */
export function WantedStars({ active, label }: { active: boolean; label: string }) {
  return (
    <span className="wanted-cell">
      <span className="wanted-stars" data-active={active ? "" : undefined} aria-hidden>
        ★★★★★
      </span>
      <small>{label}</small>
    </span>
  );
}

const HEX = /^#?[0-9a-f]{6}$/i;

/** Inline variable with the faction colour; nothing when the faction has no colour set. */
export function factionStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color || !HEX.test(color)) return undefined;
  return { "--faction-color": color.startsWith("#") ? color : `#${color}` } as CSSProperties;
}

/** Faction code with its emblem, tinted with the colour set in «Фракции». */
export function FactionBadge({ code, color }: { code: string | null | undefined; color?: string | null | undefined }) {
  if (!code) return <>—</>;
  return (
    <span className="faction-badge" style={factionStyle(color)}>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
        <path d="M12 2.5 20 5.500v6c0 4.8-3.3 8.3-8 10-4.7-1.7-8-5.2-8-10v-6l8-3Z" />
      </svg>
      {code}
    </span>
  );
}

/** «⋯»: the rare actions of a row or a card. Works without scripts; the shell closes it on an outside click. */
export function MoreMenu({ children, label = "Ещё" }: { children: ReactNode; label?: string }) {
  return (
    <details className="more-menu">
      <summary aria-label={label} title={label}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
          <circle cx="5.5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="18.5" cy="12" r="1.6" />
        </svg>
      </summary>
      <div className="menu-pop">{children}</div>
    </details>
  );
}

/** Loading placeholders for the three page shapes. */
export function SkeletonHead() {
  return (
    <div className="section-head">
      <span className="skeleton sk sk-title" />
      <span className="skeleton sk sk-line" />
    </div>
  );
}

export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <SkeletonHead />
      <div className="sk-toolbar">
        <span className="skeleton sk sk-control" />
        <span className="skeleton sk sk-control" />
      </div>
      <div className="panel">
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="skeleton sk sk-row" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonForm({ fields = 5 }: { fields?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <SkeletonHead />
      <span className="skeleton sk sk-tabs" />
      <div className="panel">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="sk-field">
            <span className="skeleton sk sk-label" />
            <span className="skeleton sk sk-control" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonCards() {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <SkeletonHead />
      <div className="metric-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="metric-card">
            <span className="skeleton sk sk-label" />
            <span className="skeleton sk sk-value" />
          </div>
        ))}
      </div>
      <div className="panel">
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="skeleton sk sk-row" />
        ))}
      </div>
    </div>
  );
}

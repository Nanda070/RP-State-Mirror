import Link from "next/link";

const ICONS = {
  server: "M4 6.5h16v4.5H4zM4 13h16v4.5H4zM7 8.75h.01M7 15.25h.01",
  shield: "M12 3.5 5 6v5.5c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6l-7-2.5Z",
  roles: "M12 4.5 14.2 9l4.8.7-3.5 3.4.8 4.9L12 15.7 7.7 18l.8-4.9L5 9.7 9.8 9 12 4.5Z",
  crown: "M4 17.5h16M5 15l-1-8 4.5 3.5L12 5l3.5 5.5L20 7l-1 8H5Z",
  channel: "M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M4 15h15",
  terminal: "M5 7.5 9.5 12 5 16.5M12 17h7",
  monitor: "M3.5 12h4l2.5-6 4 12 2.5-6h4",
  list: "M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01",
  doc: "M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V3.5ZM13.5 3.5V8H18M9.5 12.5h5M9.5 16h5",
  target: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  car: "M5 16.5v-4l1.7-4.2A1.5 1.5 0 0 1 8.1 7.5h7.8a1.5 1.5 0 0 1 1.4.8L19 12.5v4M4 12.5h16M7.5 16.5h.01M16.5 16.5h.01",
  swap: "M4.5 8.5h13m0 0-3-3m3 3-3 3M19.5 15.5h-13m0 0 3-3m-3 3 3 3",
  ban: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM6.5 6.5l11 11",
  tag: "M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4h7L20 11.5 12.5 19 4 12.5ZM8.5 8.5h.01",
  hook: "M9 6.5a3 3 0 1 1 5 2.2L11 14M6 17.5a3 3 0 0 1 3-3h6M15 17.5a3 3 0 1 0 3-3",
  chat: "M5 5.5h14v10H10l-4 3.5v-3.5H5v-10Z",
  key: "M14.5 9.5a4 4 0 1 1-3.9 4.9L4 21v-3.5h2.5V15H9l1.6-1.6A4 4 0 0 1 14.5 9.5ZM16 13h.01",
  link: "M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.8M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3",
} as const;

export type TabIconName = keyof typeof ICONS;

export function TabIcon({ name }: { name: TabIconName }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
      <path d={ICONS[name]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type PageTab = { key: string; label: string; icon?: TabIconName };

/** The tab named in the address, or the first one. */
export function currentTab<T extends string>(tabs: readonly { key: T }[], requested: string | undefined): T {
  return tabs.find((tab) => tab.key === requested)?.key ?? tabs[0]!.key;
}

/**
 * Tabs of a page kept in the address (`?tab=`): a tab can be linked to, and the page renders on the
 * server only what the open tab needs.
 */
export function PageTabs({ path, tabs, current }: { path: string; tabs: readonly PageTab[]; current: string }) {
  return (
    <nav className="settings-tabs" aria-label="Вкладки">
      {tabs.map((tab, index) => (
        <Link
          key={tab.key}
          href={index === 0 ? path : `${path}?tab=${tab.key}`}
          className="settings-tab"
          data-active={tab.key === current ? "" : undefined}
          aria-current={tab.key === current ? "page" : undefined}
        >
          {tab.icon ? <TabIcon name={tab.icon} /> : null}
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

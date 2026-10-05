"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { CommandPalette, openCommandPalette } from "./command-palette";
import { MskClock } from "./msk-clock";
import { NotificationsBell, type Notice } from "./notifications-bell";

type NavItem = {
  href: string;
  label: string;
  group: string;
  match?: "exact" | "prefix";
  /** Hide unless SUPER_ADMIN / ГА (`canManageSystemSettings`). */
  requiresSystemSettings?: boolean;
  /** Hide unless «Хелпер» or above (`canViewModules`). */
  requiresStaff?: boolean;
  /** Hide unless «Админ» or above (`canManageModules`). */
  requiresAdmin?: boolean;
  icon:
    | "home"
    | "user"
    | "docs"
    | "wanted"
    | "fines"
    | "people"
    | "blacklist"
    | "feedback"
    | "vehicle"
    | "uniform"
    | "settings"
    | "system"
    | "roles"
    | "factions"
    | "embeds"
    | "forms"
    | "webhooks"
    | "modules"
    | "calculator"
    | "faq"
    | "ban"
    | "sessions"
    | "audit"
    | "transfer"
    | "catalog"
    | "queue"
    | "table";
  /** Key of the «needs attention» counter shown next to the item. */
  countKey?: string;
};

const NAV: NavItem[] = [
  { href: "/overview", label: "Главная", group: "Главная", match: "exact", icon: "home" },
  { href: "/profile", label: "Профиль", group: "Главная", match: "exact", icon: "user" },
  { href: "/support", label: "Мои обращения", group: "Главная", match: "prefix", icon: "feedback" },
  { href: "/catalog", label: "Каталог ТС", group: "Игрокам", match: "prefix", icon: "catalog" },
  { href: "/calculator", label: "Калькулятор", group: "Игрокам", match: "prefix", icon: "calculator" },
  { href: "/tables", label: "Таблицы", group: "Игрокам", match: "prefix", icon: "table" },
  { href: "/faq", label: "FAQ", group: "Игрокам", match: "prefix", icon: "faq" },
  { href: "/ic-blacklist", label: "IC ЧС реестр", group: "Игрокам", match: "prefix", icon: "blacklist" },
  { href: "/documents", label: "Документы", group: "Информация", match: "prefix", icon: "docs", requiresStaff: true },
  { href: "/wanted", label: "Розыск", group: "Информация", match: "prefix", icon: "wanted", requiresStaff: true },
  { href: "/fines", label: "Штрафы", group: "Информация", match: "prefix", icon: "fines", requiresStaff: true },
  { href: "/personnel", label: "Персонал", group: "Информация", match: "prefix", icon: "people", requiresStaff: true },
  {
    href: "/registrations/vehicles",
    countKey: "vehicles",
    label: "Регистрации ТС",
    group: "Информация",
    match: "prefix",
    icon: "vehicle",
    requiresStaff: true,
  },
  {
    href: "/registrations/uniforms",
    countKey: "uniforms",
    label: "Регистрации форм",
    group: "Информация",
    match: "prefix",
    icon: "uniform",
    requiresStaff: true,
  },
  { href: "/transfers", label: "Переводы", group: "Информация", match: "prefix", icon: "transfer", requiresStaff: true, countKey: "transfers" },
  { href: "/tokens", label: "Нашивки", group: "Информация", match: "prefix", icon: "user", requiresStaff: true },
  {
    href: "/feedback",
    countKey: "feedback",
    label: "Обратная связь",
    group: "Администрирование",
    match: "prefix",
    icon: "feedback",
    requiresStaff: true,
  },
  {
    href: "/jobs",
    label: "Очередь задач",
    group: "Администрирование",
    match: "prefix",
    icon: "queue",
    countKey: "jobs",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/embeds",
    label: "Эмбеды",
    group: "Администрирование",
    match: "prefix",
    icon: "embeds",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/buttons",
    label: "Кнопки и роли",
    group: "Администрирование",
    match: "prefix",
    icon: "roles",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/forms",
    label: "Формы",
    group: "Администрирование",
    match: "prefix",
    icon: "forms",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/webhooks",
    label: "Вебхуки",
    group: "Администрирование",
    match: "prefix",
    icon: "webhooks",
    requiresSystemSettings: true,
  },
  {
    href: "/settings",
    label: "Настройки",
    group: "Технические настройки",
    match: "exact",
    icon: "settings",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/factions",
    label: "Фракции",
    group: "Технические настройки",
    match: "prefix",
    icon: "factions",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/modules",
    label: "Модули",
    group: "Технические настройки",
    match: "prefix",
    icon: "modules",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/sessions",
    label: "Сессии и аудит",
    group: "Технические настройки",
    match: "prefix",
    icon: "sessions",
    requiresSystemSettings: true,
  },
  { href: "/bans", label: "Тех. баны", group: "Технические настройки", match: "prefix", icon: "ban", requiresAdmin: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavIcon({ name }: { name: NavItem["icon"] }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    fill: "none",
    "aria-hidden": true as const,
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path
            d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M5.5 19.5c1.6-3.2 4-4.8 6.5-4.8s4.9 1.6 6.5 4.8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "docs":
      return (
        <svg {...common}>
          <path
            d="M7 3.75h7.5L19 8.25V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M14.5 3.75V8.5H19" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9 12.5h6M9 16h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "wanted":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="5.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "fines":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5v11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="2.75" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="16" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M4.5 18.5c1.2-2.4 2.9-3.6 4.5-3.6s3.3 1.2 4.5 3.6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path
            d="M14 15.2c.9-.7 2-1.1 3.1-1.1 1.4 0 2.7.7 3.9 2.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 4.5v1.6M12 17.9v1.6M4.5 12h1.6M17.9 12h1.6M6.4 6.4l1.1 1.1M16.5 16.5l1.1 1.1M17.6 6.4l-1.1 1.1M7.5 16.5l-1.1 1.1"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "system":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 19h6M12 16v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "roles":
      return (
        <svg {...common}>
          <path
            d="M8 7.5h8a2 2 0 0 1 2 2v1.2a4.3 4.3 0 0 1-4 4.2H10a4.3 4.3 0 0 1-4-4.2V9.5a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path d="M9.5 15.5 8 20l4-1.5L16 20l-1.5-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "factions":
      return (
        <svg {...common}>
          <path
            d="M12 4.5 18.5 8v8L12 19.5 5.5 16V8L12 4.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "embeds":
      return (
        <svg {...common}>
          <path d="M4.5 6.5h15v9.5H11l-4 3v-3H4.5v-9.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 10h8M8 13h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "forms":
      return (
        <svg {...common}>
          <path d="M8 4.5h8v2.5H8zM8 5.5H6.5a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1H16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m8.5 12 1.5 1.5 2.5-3M14 16.5h2M8.5 16.5h2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "webhooks":
      return (
        <svg {...common}>
          <path
            d="M8 8a4 4 0 1 1 4 4H7.5M16 16a4 4 0 1 1-4-4h4.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case "blacklist":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.6" />
          <path d="M7.5 7.5 16.5 16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "vehicle":
      return (
        <svg {...common}>
          <path
            d="M5 15.5h14l-1.2-4.2a2 2 0 0 0-1.9-1.4H8.1a2 2 0 0 0-1.9 1.4L5 15.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M7 15.5v1.8a1 1 0 0 0 1 1h1.2a1 1 0 0 0 1-1V15.5M13.8 15.5v1.8a1 1 0 0 0 1 1H16a1 1 0 0 0 1-1V15.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M8 10.2 9.2 7.5h5.6L16 10.2" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "uniform":
      return (
        <svg {...common}>
          <path
            d="M9 5.5h6l2.5 3.2V19a1 1 0 0 1-1 1H7.5a1 1 0 0 1-1-1V8.7L9 5.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M9 5.5 12 8.5 15 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M9.5 13h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "feedback":
      return (
        <svg {...common}>
          <path
            d="M5 7.5h14v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3A1.5 1.5 0 0 1 5 16.5v-9Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "calculator":
      return (
        <svg {...common}>
          <rect x="5.5" y="3.75" width="13" height="16.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8.5 7.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path
            d="M8.75 11.5h.01M12 11.5h.01M15.25 11.5h.01M8.75 14.5h.01M12 14.5h.01M15.25 14.5h.01M8.75 17.25h.01M12 17.25h.01M15.25 17.25h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "faq":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M9.75 9.75a2.25 2.25 0 1 1 3.4 1.93c-.7.42-1.15.95-1.15 1.82"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <path d="M12 16.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "ban":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
          <path d="m6.5 6.5 11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "sessions":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8.5 19.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <path d="M7 4.5h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 9h6M9 12.5h6M9 16h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "transfer":
      return (
        <svg {...common}>
          <path
            d="M4.5 8.5h13m0 0-3-3m3 3-3 3M19.5 15.5h-13m0 0 3-3m-3 3 3 3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "catalog":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="4" y="13.5" width="7" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="13" y="13.5" width="7" height="5.5" rx="1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "table":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 10h16M4 14.5h16M10 5v14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "queue":
      return (
        <svg {...common}>
          <path d="M5 7h14M5 12h14M5 17h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="m16.5 17 1.5 1.5 2.5-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "modules":
      return (
        <svg {...common}>
          <rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
          <rect x="13" y="4.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
          <rect x="4.5" y="13" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
          <rect x="13" y="13" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    default:
      return null;
  }
}

const COLLAPSED_KEY = "mirror.nav.collapsed";
const NOTICES_REFRESH_MS = 60_000;

export function AppShell({
  children,
  displayName,
  username,
  avatarUrl,
  canManageSystemSettings = false,
  canViewModules = false,
  canManageModules = false,
  instanceLabel = null,
}: {
  children: ReactNode;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  canManageSystemSettings?: boolean;
  canViewModules?: boolean;
  canManageModules?: boolean;
  /** «Тестовая копия» on the test installation: nobody mistakes it for the real site. */
  instanceLabel?: string | null;
}) {
  const pathname = usePathname();
  // Phone layout: the menu is a drawer. It closes when a page opens and on Escape.
  const [navOpen, setNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    setNavOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!navOpen && !userMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen, userMenuOpen]);

  // A click outside closes the user menu and any open «⋯» menu.
  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".sidebar-foot")) setUserMenuOpen(false);
      for (const menu of document.querySelectorAll("details.more-menu[open]")) {
        if (!target || !menu.contains(target)) menu.removeAttribute("open");
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  // On a phone a table row is a card: every cell needs the name of its column.
  useEffect(() => {
    const main = document.querySelector(".content");
    if (!main) return;
    const label = () => {
      for (const table of main.querySelectorAll("table.registry-table")) {
        const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
        for (const row of table.querySelectorAll("tbody tr")) {
          [...row.children].forEach((cell, index) => {
            const text = heads[index] ?? "";
            if (cell instanceof HTMLElement && cell.dataset.label !== text) cell.dataset.label = text;
          });
        }
      }
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  // Which groups the viewer folded: remembered in this browser.
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
      if (Array.isArray(saved)) setCollapsed(saved.filter((entry): entry is string => typeof entry === "string"));
    } catch {
      // Storage is blocked: every group stays open.
    }
  }, []);
  function toggleGroup(group: string) {
    setCollapsed((prev) => {
      const next = prev.includes(group) ? prev.filter((entry) => entry !== group) : [...prev, group];
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, but folded for this page view.
      }
      return next;
    });
  }

  // One request feeds both the bell and the counters in the menu.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { notices?: Notice[] };
        if (!cancelled) setNotices(data.notices ?? []);
      } catch {
        // Offline or the server is restarting: keep what is shown.
      }
    }
    void load();
    const timer = setInterval(() => void load(), NOTICES_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  const visibleNav = NAV.filter(
    (item) =>
      (!item.requiresSystemSettings || canManageSystemSettings) &&
      (!item.requiresStaff || canViewModules) &&
      (!item.requiresAdmin || canManageModules),
  );
  const groups = [...new Set(visibleNav.map((item) => item.group))];
  const current = visibleNav.find((item) => isActive(pathname, item)) ?? null;
  const counts = new Map(notices.map((notice) => [notice.key, notice.count]));
  const initial = (displayName.trim().charAt(0) || "?").toUpperCase();
  const handleLabel = username ? `@${username}` : displayName;

  return (
    <div className="shell" data-nav-open={navOpen ? "" : undefined}>
      <div className="nav-backdrop" aria-hidden onClick={() => setNavOpen(false)} />
      <aside className="sidebar" id="app-sidebar">
        <div className="sidebar-server-card">
          <BrandMark />
          <div className="sidebar-server-meta">
            <div className="sidebar-server-title">Mirror · GTA5RP</div>
            <p className="sidebar-server-sub">Государственные фракции</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((group) => {
            const items = visibleNav.filter((item) => item.group === group);
            const holdsCurrent = items.some((item) => item === current);
            // The group with the open page never hides it.
            const folded = collapsed.includes(group) && !holdsCurrent;
            const groupCount = items.reduce((sum, item) => sum + (item.countKey ? (counts.get(item.countKey) ?? 0) : 0), 0);
            return (
              <div key={group} className="nav-group" data-folded={folded ? "" : undefined}>
                <button type="button" className="nav-label" aria-expanded={!folded} onClick={() => toggleGroup(group)}>
                  <span>{group}</span>
                  {folded && groupCount > 0 ? <span className="nav-count">{groupCount}</span> : null}
                  <svg className="nav-label-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden>
                    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {folded
                  ? null
                  : items.map((item) => {
                      const count = item.countKey ? (counts.get(item.countKey) ?? 0) : 0;
                      return (
                        <Link key={item.href} href={item.href} className="nav-link" data-active={item === current}>
                          <span className="nav-link-icon">
                            <NavIcon name={item.icon} />
                          </span>
                          <span className="nav-link-label">{item.label}</span>
                          {count > 0 ? <span className="nav-count">{count > 99 ? "99+" : count}</span> : null}
                        </Link>
                      );
                    })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          {userMenuOpen ? (
            <div className="user-menu" role="menu">
              <Link href="/profile" role="menuitem">
                Профиль
              </Link>
              <Link href="/profile?tab=sessions" role="menuitem">
                Мои сессии
              </Link>
              <div className="user-menu-sep" />
              <Link href="/terms" role="menuitem">
                Условия использования
              </Link>
              <Link href="/privacy" role="menuitem">
                Конфиденциальность
              </Link>
              <Link href="/cookies" role="menuitem">
                Cookie
              </Link>
              <div className="user-menu-sep" />
              <button type="button" role="menuitem" className="user-menu-danger" onClick={() => signOut({ callbackUrl: "/" })}>
                Выйти
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="user-card"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((value) => !value)}
          >
            {avatarUrl ? (
              <Image className="topbar-avatar" src={avatarUrl} alt="" width={34} height={34} unoptimized />
            ) : (
              <span className="topbar-avatar topbar-avatar-fallback" aria-hidden>
                {initial}
              </span>
            )}
            <span className="user-card-meta">
              <span className="user-card-name">{displayName}</span>
              <span className="user-card-handle">{handleLabel}</span>
            </span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden>
              <path d="m8 10 4-4 4 4M8 14l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-btn nav-burger"
              aria-label={navOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={navOpen}
              aria-controls="app-sidebar"
              onClick={() => setNavOpen((value) => !value)}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            {current ? (
              <div className="topbar-crumbs">
                <span className="topbar-crumb-group">{current.group}</span>
                <span aria-hidden>/</span>
                <span className="topbar-crumb-page">{current.label}</span>
              </div>
            ) : null}
          </div>

          <div className="topbar-right">
            {instanceLabel ? (
              <span className="instance-label" title="Изменения здесь не попадают на основной сайт">
                {instanceLabel}
              </span>
            ) : null}
            <MskClock />
            <button type="button" className="topbar-search" onClick={() => openCommandPalette()} aria-label="Поиск">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="topbar-search-label">Поиск</span>
              <kbd className="topbar-kbd">Ctrl K</kbd>
            </button>
            <NotificationsBell notices={notices} />
          </div>
        </header>

        <motion.main
          className="content"
          initial={{ y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          key={pathname}
        >
          {children}
        </motion.main>
      </div>

      <CommandPalette
        canManageSystemSettings={canManageSystemSettings}
        canViewModules={canViewModules}
        canManageModules={canManageModules}
      />
    </div>
  );
}

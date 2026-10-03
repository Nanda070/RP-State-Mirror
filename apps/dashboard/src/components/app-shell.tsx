"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { CommandPalette, openCommandPalette } from "./command-palette";
import { NotificationsBell } from "./notifications-bell";

type NavItem = {
  href: string;
  label: string;
  group: string;
  match?: "exact" | "prefix";
  /** Hide unless SUPER_ADMIN / ГА (`canManageSystemSettings`). */
  requiresSystemSettings?: boolean;
  icon:
    | "home"
    | "user"
    | "docs"
    | "wanted"
    | "fines"
    | "people"
    | "blacklist"
    | "feedback"
    | "settings"
    | "system"
    | "roles"
    | "factions"
    | "embeds"
    | "forms"
    | "webhooks"
    | "modules";
};

const NAV: NavItem[] = [
  { href: "/overview", label: "Главная", group: "Главная", match: "exact", icon: "home" },
  { href: "/profile", label: "Профиль", group: "Главная", match: "exact", icon: "user" },
  { href: "/documents", label: "Документы", group: "Информация", match: "prefix", icon: "docs" },
  { href: "/wanted", label: "Розыск", group: "Информация", match: "prefix", icon: "wanted" },
  { href: "/fines", label: "Штрафы", group: "Информация", match: "prefix", icon: "fines" },
  { href: "/personnel", label: "Персонал", group: "Информация", match: "prefix", icon: "people" },
  { href: "/ic-blacklist", label: "IC ЧС реестр", group: "Информация", match: "prefix", icon: "blacklist" },
  { href: "/feedback", label: "Обратная связь", group: "Информация", match: "prefix", icon: "feedback" },
  { href: "/settings/embeds", label: "Эмбеды", group: "Администрирование", match: "prefix", icon: "embeds" },
  { href: "/settings/forms", label: "Discord-формы", group: "Администрирование", match: "prefix", icon: "forms" },
  { href: "/settings/webhooks", label: "Webhooks", group: "Администрирование", match: "prefix", icon: "webhooks" },
  {
    href: "/settings",
    label: "Настройки",
    group: "Настройка Фракций",
    match: "exact",
    icon: "settings",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/system",
    label: "Система",
    group: "Настройка Фракций",
    match: "prefix",
    icon: "system",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/roles",
    label: "Роли",
    group: "Настройка Фракций",
    match: "prefix",
    icon: "roles",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/factions",
    label: "Фракции",
    group: "Настройка Фракций",
    match: "prefix",
    icon: "factions",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/stage4",
    label: "Модули",
    group: "Настройка Фракций",
    match: "prefix",
    icon: "modules",
    requiresSystemSettings: true,
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  if (item.href === "/settings/system") {
    return pathname.startsWith("/settings/system") || pathname.startsWith("/settings/guilds");
  }
  if (item.href === "/settings/stage4") {
    return (
      pathname.startsWith("/settings/stage4") ||
      pathname.startsWith("/settings/tokens") ||
      pathname.startsWith("/settings/registrations")
    );
  }
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
          <rect x="4.5" y="5.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
          <rect x="4.5" y="5.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 9.5h5M8 13h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "forms":
      return (
        <svg {...common}>
          <rect x="5" y="4.5" width="14" height="15" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 9h8M8 12.5h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

export function AppShell({
  children,
  displayName,
  username,
  avatarUrl,
  canManageSystemSettings = false,
}: {
  children: ReactNode;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  canManageSystemSettings?: boolean;
}) {
  const pathname = usePathname();
  const visibleNav = NAV.filter(
    (item) => !item.requiresSystemSettings || canManageSystemSettings,
  );
  const groups = [...new Set(visibleNav.map((item) => item.group))];
  const initial = (displayName.trim().charAt(0) || "?").toUpperCase();
  const handleLabel = username ? `@${username}` : displayName;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-server-card">
          <BrandMark />
          <div className="sidebar-server-meta">
            <div className="sidebar-server-title">Mirror · GTA5RP</div>
            <p className="sidebar-server-sub">Государственные фракции</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group} className="nav-group">
              <div className="nav-label">{group}</div>
              {visibleNav
                .filter((item) => item.group === group)
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="nav-link"
                    data-active={isActive(pathname, item)}
                  >
                    <span className="nav-link-icon">
                      <NavIcon name={item.icon} />
                    </span>
                    <span className="nav-link-label">{item.label}</span>
                  </Link>
                ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button
            type="button"
            className="sidebar-signout"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
              <path
                d="M10 7V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-1"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M15 12H4m0 0 3-3M4 12l3 3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Выйти
          </button>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-left">
            <Link href="/overview" className="topbar-brand">
              <BrandMark />
              <span className="brand">Mirror</span>
            </Link>
            <nav className="topbar-links" aria-label="Ссылки">
              <Link href="/terms">Условия</Link>
              <Link href="/privacy">Конфиденциальность</Link>
            </nav>
          </div>

          <div className="topbar-right">
            <button
              type="button"
              className="topbar-search"
              onClick={() => openCommandPalette()}
              aria-label="Поиск"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
                <circle cx="11" cy="11" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                <path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <span className="topbar-search-label">Поиск</span>
              <kbd className="topbar-kbd">Ctrl K</kbd>
            </button>

            <NotificationsBell variant="icon" />

            <div className="topbar-user">
              {avatarUrl ? (
                <Image
                  className="topbar-avatar"
                  src={avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  unoptimized
                />
              ) : (
                <div className="topbar-avatar topbar-avatar-fallback" aria-hidden>
                  {initial}
                </div>
              )}
              <span className="topbar-username" title={handleLabel}>
                {handleLabel}
              </span>
            </div>
          </div>
        </header>

        <motion.main
          className="content"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
        >
          {children}
        </motion.main>
      </div>
      <CommandPalette canManageSystemSettings={canManageSystemSettings} />
    </div>
  );
}

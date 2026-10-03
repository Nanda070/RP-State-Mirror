"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { CommandPalette } from "./command-palette";
import { MskClock } from "./msk-clock";
import { NotificationsBell } from "./notifications-bell";

type NavItem = {
  href: string;
  label: string;
  group: string;
  match?: "exact" | "prefix";
};

const NAV: NavItem[] = [
  { href: "/overview", label: "Обзор", group: "Основное", match: "exact" },
  { href: "/profile", label: "Профиль", group: "Основное", match: "exact" },
  { href: "/documents", label: "Документы", group: "Реестры", match: "prefix" },
  { href: "/wanted", label: "Розыск", group: "Реестры", match: "prefix" },
  { href: "/fines", label: "Штрафы", group: "Реестры", match: "prefix" },
  { href: "/personnel", label: "Персонал", group: "Реестры", match: "prefix" },
  { href: "/settings", label: "Настройки", group: "Администрирование", match: "exact" },
  { href: "/settings/system", label: "Система", group: "Администрирование", match: "prefix" },
  { href: "/settings/roles", label: "Роли", group: "Администрирование", match: "prefix" },
  { href: "/settings/factions", label: "Фракции", group: "Администрирование", match: "prefix" },
];

const CRUMBS: { test: (path: string) => boolean; section: string; page: string }[] = [
  { test: (p) => p === "/overview", section: "Основное", page: "Обзор" },
  { test: (p) => p === "/profile", section: "Основное", page: "Профиль" },
  { test: (p) => p.startsWith("/documents"), section: "Реестры", page: "Документы" },
  { test: (p) => p.startsWith("/wanted"), section: "Реестры", page: "Розыск" },
  { test: (p) => p.startsWith("/fines"), section: "Реестры", page: "Штрафы" },
  { test: (p) => p.startsWith("/personnel"), section: "Реестры", page: "Персонал" },
  { test: (p) => p === "/settings", section: "Администрирование", page: "Настройки" },
  { test: (p) => p.startsWith("/settings/system") || p.startsWith("/settings/guilds"), section: "Настройки", page: "Система" },
  { test: (p) => p.startsWith("/settings/roles"), section: "Настройки", page: "Роли" },
  { test: (p) => p.startsWith("/settings/factions"), section: "Настройки", page: "Фракции" },
  { test: (p) => p.startsWith("/settings/documents"), section: "Настройки", page: "Документы" },
  { test: (p) => p.startsWith("/settings/wanted"), section: "Настройки", page: "Розыск" },
  { test: (p) => p.startsWith("/settings/fines"), section: "Настройки", page: "Штрафы" },
  { test: (p) => p.startsWith("/settings/tokens"), section: "Настройки", page: "Токены" },
  { test: (p) => p.startsWith("/settings/registrations"), section: "Настройки", page: "Регистрации" },
  { test: (p) => p.startsWith("/settings/embeds"), section: "Настройки", page: "Эмбеды" },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  if (item.href === "/settings/system") {
    return pathname.startsWith("/settings/system") || pathname.startsWith("/settings/guilds");
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppShell({
  children,
  displayName,
  username,
  avatarUrl,
}: {
  children: ReactNode;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}) {
  const pathname = usePathname();
  const groups = [...new Set(NAV.map((item) => item.group))];
  const crumb = CRUMBS.find((c) => c.test(pathname));
  const initial = (displayName.trim().charAt(0) || "?").toUpperCase();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-row">
            <BrandMark />
            <div className="brand-text">
              <div className="brand">Mirror · GTA5RP</div>
              <p>Дашборд государственных фракций</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group} className="nav-group">
              <div className="nav-label">{group}</div>
              {NAV.filter((item) => item.group === group).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-link"
                  data-active={isActive(pathname, item)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="user-block">
            <div className="user-avatar-wrap">
              {avatarUrl ? (
                <Image
                  className="user-avatar"
                  src={avatarUrl}
                  alt=""
                  width={36}
                  height={36}
                  unoptimized
                />
              ) : (
                <div className="user-avatar user-avatar-fallback" aria-hidden>
                  {initial}
                </div>
              )}
              <span className="user-online-dot" aria-hidden />
            </div>
            <div className="user-meta">
              <div className="user-name" title={displayName}>
                {displayName}
              </div>
              <div className="user-handle" title={username ? `@${username}` : undefined}>
                {username ? `@${username}` : "—"}
              </div>
            </div>
            <div className="user-actions">
              <NotificationsBell variant="icon" />
              <button
                type="button"
                className="icon-btn"
                title="Выйти"
                aria-label="Выйти"
                onClick={() => signOut({ callbackUrl: "/" })}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden>
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
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <nav className="breadcrumbs" aria-label="Навигация">
            <svg className="breadcrumbs-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
              <path
                d="M4 8.5 12 3l8 5.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1V8.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            {crumb ? (
              <>
                <span className="crumb-section">{crumb.section}</span>
                <span className="crumb-sep" aria-hidden>
                  ›
                </span>
                <span className="crumb-page">{crumb.page}</span>
              </>
            ) : (
              <span className="crumb-page">Mirror</span>
            )}
          </nav>
          <MskClock />
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
      <CommandPalette />
    </div>
  );
}

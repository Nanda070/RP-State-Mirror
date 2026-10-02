"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";
import { CommandPalette } from "./command-palette";
import { NotificationsBell } from "./notifications-bell";

const NAV = [
  { href: "/overview", label: "Обзор", group: "Основное" },
  { href: "/profile", label: "Профиль", group: "Основное" },
  { href: "/settings", label: "Настройки", group: "Администрирование" },
  { href: "/settings/guilds", label: "Серверы", group: "Администрирование" },
  { href: "/settings/roles", label: "Роли", group: "Администрирование" },
];

export function AppShell({
  children,
  userLabel,
}: {
  children: ReactNode;
  userLabel: string;
}) {
  const pathname = usePathname();
  const groups = [...new Set(NAV.map((item) => item.group))];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <BrandMark />
          <div className="brand">Mirror · GTA5RP</div>
          <p>Дашборд государственных фракций</p>
        </div>
        {groups.map((group) => (
          <div key={group} className="nav-group">
            <div className="nav-label">{group}</div>
            {NAV.filter((item) => item.group === group).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                data-active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            {userLabel}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: "100%" }}
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Выйти
          </button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div className="muted">Ctrl+K — быстрый переход</div>
          <div className="row">
            <NotificationsBell />
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
      <CommandPalette />
    </div>
  );
}

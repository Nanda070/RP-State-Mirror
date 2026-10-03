"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export const COMMAND_PALETTE_EVENT = "mirror:open-command-palette";

export function openCommandPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COMMAND_PALETTE_EVENT));
}

type PaletteItem = {
  href: string;
  label: string;
  group: string;
  requiresSystemSettings?: boolean;
  requiresStaff?: boolean;
};

const ITEMS: PaletteItem[] = [
  { href: "/overview", label: "Главная", group: "Главная" },
  { href: "/profile", label: "Профиль", group: "Главная" },
  { href: "/catalog", label: "Каталог ТС", group: "Игрокам" },
  { href: "/calculator", label: "Калькулятор переводов", group: "Игрокам" },
  { href: "/faq", label: "FAQ и документация", group: "Игрокам" },
  { href: "/documents", label: "Документы", group: "Информация", requiresStaff: true },
  { href: "/wanted", label: "Розыск", group: "Информация", requiresStaff: true },
  { href: "/fines", label: "Штрафы", group: "Информация", requiresStaff: true },
  { href: "/personnel", label: "Персонал", group: "Информация", requiresStaff: true },
  { href: "/registrations/vehicles", label: "Регистрации ТС", group: "Информация", requiresStaff: true },
  { href: "/registrations/uniforms", label: "Регистрации форм", group: "Информация", requiresStaff: true },
  { href: "/ic-blacklist", label: "IC ЧС реестр", group: "Информация", requiresStaff: true },
  { href: "/feedback", label: "Обратная связь", group: "Администрирование", requiresStaff: true },
  { href: "/settings/embeds", label: "Эмбеды", group: "Администрирование", requiresSystemSettings: true },
  { href: "/settings/buttons", label: "Кнопки и роли", group: "Администрирование", requiresSystemSettings: true },
  { href: "/settings/forms", label: "Формы", group: "Администрирование", requiresSystemSettings: true },
  { href: "/settings/webhooks", label: "Webhooks", group: "Администрирование", requiresSystemSettings: true },
  {
    href: "/settings",
    label: "Настройки — каталог модулей",
    group: "Настройка Фракций",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/system",
    label: "Система: главный сервер и ЧП",
    group: "Настройка Фракций",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/roles",
    label: "Привязка ролей",
    group: "Настройка Фракций",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/factions",
    label: "Каналы фракций",
    group: "Настройка Фракций",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/stage4",
    label: "Конфигурация модулей",
    group: "Настройка Фракций",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/documents",
    label: "Настройки документов",
    group: "Настройка Фракций",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/wanted",
    label: "Настройки розыска",
    group: "Настройка Фракций",
    requiresSystemSettings: true,
  },
  {
    href: "/settings/fines",
    label: "Настройки штрафов",
    group: "Настройка Фракций",
    requiresSystemSettings: true,
  },
  { href: "/terms", label: "Условия использования", group: "Прочее" },
  { href: "/privacy", label: "Конфиденциальность", group: "Прочее" },
  { href: "/cookies", label: "Cookie", group: "Прочее" },
];

export function CommandPalette({
  canManageSystemSettings = false,
  canViewModules = false,
}: {
  canManageSystemSettings?: boolean;
  canViewModules?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const allowedItems = useMemo(
    () =>
      ITEMS.filter(
        (item) =>
          (!item.requiresSystemSettings || canManageSystemSettings) &&
          (!item.requiresStaff || canViewModules),
      ),
    [canManageSystemSettings, canViewModules],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allowedItems;
    return allowedItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.href.includes(q) ||
        item.group.toLowerCase().includes(q),
    );
  }, [allowedItems, query]);

  useEffect(() => {
    const openPalette = () => {
      setOpen(true);
      setQuery("");
      setActive(0);
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery("");
        setActive(0);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_PALETTE_EVENT, openPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_PALETTE_EVENT, openPalette);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="command-overlay" onClick={() => setOpen(false)}>
      <div
        className="command-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Глобальный поиск"
      >
        <input
          autoFocus
          placeholder="Поиск разделов…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (event.key === "Enter") {
              const item = results[active];
              if (item) {
                setOpen(false);
                router.push(item.href);
              }
            }
          }}
        />
        <div className="command-list">
          {results.length === 0 ? (
            <div style={{ padding: "1rem" }} className="muted">
              Ничего не найдено
            </div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.href}
                type="button"
                data-active={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  setOpen(false);
                  router.push(item.href);
                }}
              >
                <span className="command-item-label">{item.label}</span>
                <span className="command-item-group muted">{item.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

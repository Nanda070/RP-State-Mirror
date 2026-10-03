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
  requiresAdmin?: boolean;
};

const ITEMS: PaletteItem[] = [
  { href: "/overview", label: "Главная", group: "Главная" },
  { href: "/profile", label: "Профиль", group: "Главная" },
  { href: "/catalog", label: "Каталог ТС", group: "Игрокам" },
  { href: "/calculator", label: "Калькулятор переводов", group: "Игрокам" },
  { href: "/faq", label: "FAQ и документация", group: "Игрокам" },
  { href: "/ic-blacklist", label: "IC ЧС реестр", group: "Игрокам" },
  { href: "/documents", label: "Документы", group: "Информация", requiresStaff: true },
  { href: "/wanted", label: "Розыск", group: "Информация", requiresStaff: true },
  { href: "/fines", label: "Штрафы", group: "Информация", requiresStaff: true },
  { href: "/personnel", label: "Персонал", group: "Информация", requiresStaff: true },
  { href: "/registrations/vehicles", label: "Регистрации ТС", group: "Информация", requiresStaff: true },
  { href: "/registrations/uniforms", label: "Регистрации форм", group: "Информация", requiresStaff: true },
  { href: "/feedback", label: "Обратная связь", group: "Администрирование", requiresStaff: true },
  { href: "/bans", label: "Технические баны", group: "Технические настройки", requiresAdmin: true },
  { href: "/jobs", label: "Очередь задач", group: "Администрирование", requiresSystemSettings: true },
  { href: "/transfers", label: "Переводы между фракциями", group: "Информация", requiresStaff: true },
  { href: "/tokens", label: "Нашивки и персонажи", group: "Информация", requiresStaff: true },
  { href: "/settings/embeds", label: "Эмбеды", group: "Администрирование", requiresSystemSettings: true },
  { href: "/settings/buttons", label: "Кнопки и роли", group: "Администрирование", requiresSystemSettings: true },
  { href: "/settings/forms", label: "Формы", group: "Администрирование", requiresSystemSettings: true },
  { href: "/settings/webhooks", label: "Вебхуки", group: "Администрирование", requiresSystemSettings: true },
  { href: "/settings", label: "Настройки: серверы и синхронизация", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/settings?tab=safety", label: "Настройки: блокировка и мониторинг", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/settings/factions", label: "Фракции: привязка ролей", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/settings/factions?tab=admin", label: "Фракции: роли администрации", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/settings/factions?tab=channels", label: "Фракции: каналы", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/settings/factions?tab=commands", label: "Фракции: права команд", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/settings/modules", label: "Модули", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/settings/sessions", label: "Сессии и входы", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/settings/sessions?tab=audit", label: "Журнал аудита", group: "Технические настройки", requiresSystemSettings: true },
  { href: "/profile?tab=sessions", label: "Мои сессии", group: "Главная" },
  { href: "/terms", label: "Условия использования", group: "Прочее" },
  { href: "/privacy", label: "Конфиденциальность", group: "Прочее" },
  { href: "/cookies", label: "Cookie", group: "Прочее" },
];

export function CommandPalette({
  canManageSystemSettings = false,
  canViewModules = false,
  canManageModules = false,
}: {
  canManageSystemSettings?: boolean;
  canViewModules?: boolean;
  canManageModules?: boolean;
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
          (!item.requiresStaff || canViewModules) &&
          (!item.requiresAdmin || canManageModules),
      ),
    [canManageSystemSettings, canViewModules, canManageModules],
  );

  // Records found on the server for the typed text: numbers, statics, names.
  const [hits, setHits] = useState<PaletteItem[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { hits: [] }))
        .then((data: { hits?: { kind: string; title: string; detail: string; href: string }[] }) => {
          setHits(
            (data.hits ?? []).map((hit) => ({
              href: hit.href,
              label: hit.detail ? `${hit.title} — ${hit.detail}` : hit.title,
              group: hit.kind,
            })),
          );
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allowedItems;
    const sections = allowedItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.href.includes(q) ||
        item.group.toLowerCase().includes(q),
    );
    return [...sections, ...hits];
  }, [allowedItems, query, hits]);

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
          placeholder="Раздел, статик, номер документа, ФИО…"
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
                key={`${item.group}:${item.href}:${item.label}`}
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

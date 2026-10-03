"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const ITEMS = [
  { href: "/overview", label: "Обзор" },
  { href: "/profile", label: "Профиль" },
  { href: "/documents", label: "Реестр документов" },
  { href: "/wanted", label: "Реестр розыска" },
  { href: "/fines", label: "Реестр штрафов" },
  { href: "/personnel", label: "Реестр персонала" },
  { href: "/settings", label: "Настройки — каталог модулей" },
  { href: "/settings/system", label: "Система: главный сервер и ЧП" },
  { href: "/settings/roles", label: "Привязка ролей" },
  { href: "/settings/factions", label: "Каналы фракций" },
  { href: "/settings/documents", label: "Настройки документов" },
  { href: "/settings/wanted", label: "Настройки розыска" },
  { href: "/settings/fines", label: "Настройки штрафов" },
  { href: "/settings/embeds", label: "Эмбеды и кнопки" },
  { href: "/settings/tokens", label: "Токены (скоро)" },
  { href: "/settings/registrations", label: "Регистрации (скоро)" },
  { href: "/terms", label: "Условия использования" },
  { href: "/privacy", label: "Конфиденциальность" },
  { href: "/cookies", label: "Cookie" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.filter((item) => item.label.toLowerCase().includes(q) || item.href.includes(q));
  }, [query]);

  useEffect(() => {
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
    return () => window.removeEventListener("keydown", onKey);
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
                {item.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

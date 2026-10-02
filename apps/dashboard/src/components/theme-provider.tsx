"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const THEMES = [
  { id: "mirror", label: "Зеркало" },
  { id: "graphite", label: "Графит" },
  { id: "midnight", label: "Полночь" },
  { id: "ocean", label: "Океан" },
  { id: "pine", label: "Хвоя" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const ThemeContext = createContext<{
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}>({ theme: "mirror", setTheme: () => undefined });

const STORAGE_KEY = "mirror.theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("mirror");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (saved && THEMES.some((t) => t.id === saved)) {
      setThemeState(saved);
      document.documentElement.dataset.theme = saved;
    } else {
      document.documentElement.dataset.theme = "mirror";
    }
  }, []);

  const setTheme = (next: ThemeId) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  return (
    <select
      aria-label="Тема оформления"
      value={theme}
      onChange={(event) => setTheme(event.target.value as ThemeId)}
    >
      {THEMES.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

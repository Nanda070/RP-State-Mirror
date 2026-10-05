/**
 * The person's colour preset and accent on the page. Safe for client components: no core imports.
 * Mirrors THEME_PRESETS in @mirror/core; the colours are `[data-theme]` blocks in globals.css.
 */
export const THEMES = [
  { key: "mirror", label: "Mirror", hint: "Тёмная, оранжевый акцент", swatch: ["#0d0d0d", "#161616", "#ff6a1a"] },
  { key: "midnight", label: "Полночь", hint: "Тёмно-синяя", swatch: ["#070b14", "#111827", "#4f8cff"] },
  { key: "emerald", label: "Изумруд", hint: "Тёмно-зелёная", swatch: ["#060d0a", "#0f1b16", "#2fd08c"] },
  { key: "crimson", label: "Багрянец", hint: "Тёмно-красная", swatch: ["#0e0708", "#1b1012", "#f0435a"] },
  { key: "graphite", label: "Графит", hint: "Серая, светлый акцент", swatch: ["#131315", "#1d1d21", "#d4d4d8"] },
] as const;

export type ThemeKey = (typeof THEMES)[number]["key"];
export type AppearanceValue = { theme: ThemeKey; accentColor: string | null };

export const APPEARANCE_COOKIE = "mirror-appearance";
const HEX = /^#[0-9a-f]{6}$/;

export function isThemeKey(value: string): value is ThemeKey {
  return THEMES.some((theme) => theme.key === value);
}

/** Dark text on a light accent, white on a dark one (relative luminance, WCAG). */
export function accentContrast(hex: string): string {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.35 ? "#140900" : "#ffffff";
}

/** `theme|#rrggbb` (accent may be empty). */
export function encodeAppearance(value: AppearanceValue): string {
  return `${value.theme}|${value.accentColor ?? ""}`;
}

export function decodeAppearance(raw: string | undefined | null): AppearanceValue | null {
  if (!raw) return null;
  const [theme = "", accent = ""] = decodeURIComponent(raw).split("|");
  if (!isThemeKey(theme)) return null;
  return { theme, accentColor: HEX.test(accent) ? accent : null };
}

/** Puts the preset on <html> and the own accent over it; remembers both for the next page load. */
export function applyAppearance(value: AppearanceValue) {
  const root = document.documentElement;
  if (value.theme === "mirror") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", value.theme);
  if (value.accentColor) {
    root.style.setProperty("--accent", value.accentColor);
    root.style.setProperty("--accent-contrast", accentContrast(value.accentColor));
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-contrast");
  }
  document.cookie = `${APPEARANCE_COOKIE}=${encodeURIComponent(encodeAppearance(value))}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Runs in <head> before the first paint, so a page never flashes in the default colours.
 * Plain ES5 on purpose: it is inlined as text, not bundled.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )${APPEARANCE_COOKIE}=([^;]*)/);if(!m)return;
var p=decodeURIComponent(m[1]).split("|"),t=p[0],a=p[1]||"",r=document.documentElement;
if(${JSON.stringify(THEMES.map((theme) => theme.key))}.indexOf(t)>0)r.setAttribute("data-theme",t);
if(/^#[0-9a-f]{6}$/.test(a)){
var c=function(i){var v=parseInt(a.substr(i,2),16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
var l=0.2126*c(1)+0.7152*c(3)+0.0722*c(5);
r.style.setProperty("--accent",a);r.style.setProperty("--accent-contrast",l>0.35?"#140900":"#ffffff");}
}catch(e){}})();`;

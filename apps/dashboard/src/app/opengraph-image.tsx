import { ImageResponse } from "next/og";

export const alt = "Mirror · GTA5RP";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Link preview for messengers: the emblem and the name on the site's own colours. Latin only — the built-in font has no Cyrillic. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: "linear-gradient(135deg, #1a0d04 0%, #0a0a0a 55%, #0a0a0a 100%)",
          color: "#f4f4f5",
        }}
      >
        <svg width="150" height="150" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="14" fill="#0d0d0d" />
          <path d="M32 11 50 22.5v19L32 53 14 41.5v-19L32 11Z" fill="none" stroke="#ff6a1a" strokeWidth="4" strokeLinejoin="round" />
          <path d="M32 23v19M23 28.5 32 34l9-5.5" fill="none" stroke="#ff6a1a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 700, letterSpacing: 6 }}>MIRROR · GTA5RP</div>
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 10, color: "#ff6a1a" }}>STATE FACTIONS DASHBOARD</div>
      </div>
    ),
    size,
  );
}

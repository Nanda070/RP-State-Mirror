import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";
import "./player.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
  display: "swap",
});

// Headings and HUD labels: a condensed face with Cyrillic.
const oswald = Oswald({
  subsets: ["latin", "cyrillic"],
  variable: "--font-oswald",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Mirror · GTA5RP", template: "%s · Mirror" },
  description: "Дашборд государственных фракций Mirror",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={`${manrope.variable} ${oswald.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

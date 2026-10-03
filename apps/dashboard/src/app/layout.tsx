import type { Metadata } from "next";
import { Manrope, Oswald, Outfit } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";
import "./player.css";

const manrope = Manrope({
  subsets: ["latin", "cyrillic"],
  variable: "--font-manrope",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

// Headings and HUD labels: Outfit has no Cyrillic, Oswald does.
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
    <html lang="ru" className={`${manrope.variable} ${outfit.variable} ${oswald.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

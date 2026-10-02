import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mirror · GTA5RP",
  description: "Дашборд государственных фракций Mirror",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" data-theme="mirror">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

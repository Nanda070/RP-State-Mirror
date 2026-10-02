"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { CookieBanner } from "./cookie-banner";
import { ThemeProvider } from "./theme-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        {children}
        <CookieBanner />
      </ThemeProvider>
    </SessionProvider>
  );
}

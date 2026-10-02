"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { CookieBanner } from "./cookie-banner";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <CookieBanner />
    </SessionProvider>
  );
}

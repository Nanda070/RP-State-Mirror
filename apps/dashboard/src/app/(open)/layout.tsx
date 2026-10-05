import type { ReactNode } from "react";
import { OpenSection } from "@/components/open-section";

/** Catalog, calculator and FAQ hold nothing personal and open without signing in. */
export default function OpenLayout({ children }: { children: ReactNode }) {
  return <OpenSection>{children}</OpenSection>;
}

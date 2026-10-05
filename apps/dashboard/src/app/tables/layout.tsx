import type { ReactNode } from "react";
import { OpenSection } from "@/components/open-section";

/** «Таблицы» are open to everyone; the sheet takes the whole height of the window. */
export default function TablesLayout({ children }: { children: ReactNode }) {
  return <OpenSection tables>{children}</OpenSection>;
}

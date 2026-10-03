import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TablesWorkspace } from "@/components/sheets/tables-workspace";
import { loadTablesPage } from "@/lib/tables";

type PageProps = { params: Promise<{ slug: string }> };

// A table changes whenever an admin saves it.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { tabs } = await loadTablesPage();
  return { title: tabs.find((tab) => tab.slug === slug)?.title ?? "Таблицы" };
}

export default async function TablePage({ params }: PageProps) {
  const { slug } = await params;
  const { tabs, canEdit, editors } = await loadTablesPage();
  const current = tabs.find((tab) => tab.slug === slug);
  if (!current) notFound();
  return <TablesWorkspace current={current} canEdit={canEdit} otherEditor={editors[current.id] ?? null} />;
}

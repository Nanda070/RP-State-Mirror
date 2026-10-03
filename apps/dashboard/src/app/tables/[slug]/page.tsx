import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TablesWorkspace } from "@/components/sheets/tables-workspace";
import { resolveAuthorLabels } from "@/lib/discord-names";
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
  const { tabs, canEdit, editors, signedIn, restrictedSlugs, allowedIds } = await loadTablesPage();
  const current = tabs.find((tab) => tab.slug === slug);
  if (!current) {
    // The table is not open to guests: signing in may open it. Someone signed in without access gets «не найдено».
    if (!signedIn && restrictedSlugs.includes(slug)) redirect(`/?next=${encodeURIComponent(`/tables/${slug}`)}`);
    notFound();
  }
  const ids = allowedIds.get(current.id) ?? [];
  const labels = canEdit ? await resolveAuthorLabels(ids) : new Map<string, string>();
  return (
    <TablesWorkspace
      current={current}
      canEdit={canEdit}
      otherEditor={editors[current.id] ?? null}
      allowed={ids.map((id) => ({ id, label: labels.get(id) ?? id }))}
    />
  );
}

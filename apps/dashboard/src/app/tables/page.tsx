import { TablesList } from "@/components/sheets/tables-list";
import { loadTablesPage } from "@/lib/tables";

export const metadata = { title: "Таблицы" };
export const dynamic = "force-dynamic";

/** The list of tables; a table opens on its own page. */
export default async function TablesIndexPage() {
  const { tabs, canEdit, editors } = await loadTablesPage();
  return <TablesList tables={tabs} canEdit={canEdit} editors={editors} />;
}

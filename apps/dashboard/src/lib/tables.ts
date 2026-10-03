import { canManageModules, listSheetDocuments } from "@mirror/core";
import { cache } from "react";
import { auth } from "@/auth";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscowShort } from "@/lib/moscow";
import { resolveFreshIdentity } from "@/lib/session";

export type TableTab = {
  id: string;
  slug: string;
  title: string;
  version: number;
  /** When the table last changed, Moscow time. */
  updatedAt: string;
};

/** The tables and what the viewer may do with them. */
export const loadTablesPage = cache(async () => {
  const [session, documents] = await Promise.all([auth(), listSheetDocuments()]);
  const discordId = session?.user?.discordId ?? null;
  // The role is re-checked against Discord here and again by every API route.
  const canEdit = discordId ? canManageModules(await resolveFreshIdentity(discordId)) : false;

  const now = Date.now();
  const lockedBy = new Map(
    documents
      .filter((row) => row.lockDiscordId && row.lockExpiresAt && row.lockExpiresAt.getTime() > now)
      .map((row) => [row.id, row.lockDiscordId as string]),
  );
  const labels = canEdit ? await resolveAuthorLabels([...lockedBy.values()]) : new Map<string, string>();

  return {
    canEdit,
    tabs: documents.map(
      (row): TableTab => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        version: row.version,
        updatedAt: formatMoscowShort(row.updatedAt),
      }),
    ),
    /** Who is editing a table right now (shown to admins only); the viewer's own lock is not listed. */
    editors: Object.fromEntries(
      [...lockedBy.entries()].filter(([, holder]) => holder !== discordId).map(([id, holder]) => [id, labels.get(holder) ?? holder]),
    ) as Record<string, string>,
  };
});

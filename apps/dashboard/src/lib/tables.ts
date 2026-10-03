import { canManageModules, canViewSheet, listSheetDocuments, type SheetViewer } from "@mirror/core";
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
  /** PUBLIC | USERS | ADMINS. */
  access: string;
};

/** Who is asking: a guest, a signed-in person, or «Админ» and above. Re-checked against Discord. */
export const tableViewer = cache(async (): Promise<SheetViewer> => {
  const session = await auth();
  const discordId = session?.user?.discordId ?? null;
  return { discordId, isAdmin: discordId ? canManageModules(await resolveFreshIdentity(discordId)) : false };
});

/** The tables the viewer may open and what the viewer may do with them. */
export const loadTablesPage = cache(async () => {
  const [viewer, documents] = await Promise.all([tableViewer(), listSheetDocuments()]);
  const visible = documents.filter((row) => canViewSheet(row, viewer));

  const now = Date.now();
  const lockedBy = new Map(
    visible
      .filter((row) => row.lockDiscordId && row.lockExpiresAt && row.lockExpiresAt.getTime() > now)
      .map((row) => [row.id, row.lockDiscordId as string]),
  );
  const labels = viewer.isAdmin ? await resolveAuthorLabels([...lockedBy.values()]) : new Map<string, string>();

  return {
    canEdit: viewer.isAdmin,
    signedIn: viewer.discordId !== null,
    tabs: visible.map(
      (row): TableTab => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        version: row.version,
        updatedAt: formatMoscowShort(row.updatedAt),
        access: row.access,
      }),
    ),
    /** Addresses of tables that exist but are not open to this viewer: a guest is sent to sign in. */
    restrictedSlugs: documents.filter((row) => !canViewSheet(row, viewer)).map((row) => row.slug),
    /** Discord ids allowed to open each table — for admins, who set the access. */
    allowedIds: viewer.isAdmin ? new Map(documents.map((row) => [row.id, row.allowedDiscordIds])) : new Map<string, string[]>(),
    /** Who is editing a table right now (shown to admins only); the viewer's own lock is not listed. */
    editors: Object.fromEntries(
      [...lockedBy.entries()]
        .filter(([, holder]) => holder !== viewer.discordId)
        .map(([id, holder]) => [id, labels.get(holder) ?? holder]),
    ) as Record<string, string>,
  };
});

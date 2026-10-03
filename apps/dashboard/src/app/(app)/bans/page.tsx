import { canManageModules, listTechBans } from "@mirror/core";
import { RecordStatus } from "@mirror/db";
import { redirect } from "next/navigation";
import { TechBansManager } from "@/components/tech-bans-manager";
import { resolveAuthorLabels } from "@/lib/discord-names";
import { formatMoscow } from "@/lib/moscow";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Технические баны" };

export default async function TechBansPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canManageModules(identity)) redirect("/overview");

  const bans = await listTechBans();
  const labels = await resolveAuthorLabels([
    ...bans.map((ban) => ban.createdByDiscordId),
    ...bans.filter((ban) => ban.kind === "DISCORD").map((ban) => ban.value),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Технические баны</h1>
        <p className="muted">
          Запрет пользоваться ботом и сайтом. Не путать с IC чёрным списком — тот информационный и ничего не
          блокирует.
        </p>
      </div>
      <TechBansManager
        bans={bans.map((ban) => ({
          id: ban.id,
          kind: ban.kind === "STATIC" ? "STATIC" : "DISCORD",
          value: ban.value,
          subjectLabel: ban.kind === "DISCORD" ? (labels.get(ban.value) ?? ban.value) : ban.value,
          reason: ban.reason,
          active: ban.status === RecordStatus.ACTIVE,
          createdBy: labels.get(ban.createdByDiscordId) ?? ban.createdByDiscordId,
          createdAt: formatMoscow(ban.createdAt),
          revokedAt: ban.revokedAt ? formatMoscow(ban.revokedAt) : null,
        }))}
      />
    </div>
  );
}

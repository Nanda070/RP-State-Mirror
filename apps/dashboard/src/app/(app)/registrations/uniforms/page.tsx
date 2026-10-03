import { canManageModules, canViewModules, listShareLinksFor } from "@mirror/core";
import { RegistrationKind } from "@mirror/db";
import { redirect } from "next/navigation";
import { RegistrationsRegistry } from "@/components/registrations-registry";
import { listRegistrations } from "@/lib/registrations";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export default async function UniformRegistrationsPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const { total, items } = await listRegistrations({
    kind: RegistrationKind.UNIFORM,
    limit: 100,
  });

  // Public links are created and revoked by «Админ» and above; helpers only read the registry.
  const shareLinks = canManageModules(identity)
    ? await listShareLinksFor("registration", items.map((item) => item.id))
    : null;

  return (
    <RegistrationsRegistry
      title="Регистрации форм"
      description="Реестр заявок на регистрацию униформы / формы."
      emptyHint={
        <>
          Заявок пока нет. Подача через команду <code>/регистрация-формы</code> в Discord.
        </>
      }
      detailLabel="Описание"
      total={total}
      shareLinks={shareLinks}
      items={items}
    />
  );
}

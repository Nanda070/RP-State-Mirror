import { canViewModules } from "@mirror/core";
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
      items={items}
    />
  );
}

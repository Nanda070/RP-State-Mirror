import { REGISTRY_PAGE_SIZE, canManageModules, canViewModules, listShareLinksFor } from "@mirror/core";
import { RegistrationKind } from "@mirror/db";
import { redirect } from "next/navigation";
import { RegistrationsRegistry } from "@/components/registrations-registry";
import { registryQuery, type RegistrySearch } from "@/components/registry-toolbar";
import { REGISTRATION_DEFAULT_FILTER, listRegistrations } from "@/lib/registrations";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Регистрации ТС" };

export default async function VehicleRegistrationsPage({ searchParams }: { searchParams: Promise<RegistrySearch> }) {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const query = registryQuery(await searchParams);
  const { total, items } = await listRegistrations({
    kind: RegistrationKind.VEHICLE,
    q: query.q,
    display: query.status ?? REGISTRATION_DEFAULT_FILTER,
    limit: REGISTRY_PAGE_SIZE,
    offset: (query.page - 1) * REGISTRY_PAGE_SIZE,
  });
  const canAct = canManageModules(identity);
  // Public links are created and revoked by «Админ» and above; helpers only read the registry.
  const shareLinks = canAct ? await listShareLinksFor("registration", items.map((item) => item.id)) : null;

  return (
    <RegistrationsRegistry
      title="Регистрации ТС"
      description={
        <>
          Заявки на регистрацию транспорта: подаются командой <code>/регистрация-тс</code>.
        </>
      }
      path="/registrations/vehicles"
      showPlate
      detailLabel="Модель"
      total={total}
      page={query.page}
      pages={Math.max(1, Math.ceil(total / REGISTRY_PAGE_SIZE))}
      query={query}
      shareLinks={shareLinks}
      canAct={canAct}
      exportRegistry="registrations-vehicles"
      items={items}
    />
  );
}

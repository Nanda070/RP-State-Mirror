import { canViewModules } from "@mirror/core";
import { RegistrationKind } from "@mirror/db";
import { redirect } from "next/navigation";
import { RegistrationsRegistry } from "@/components/registrations-registry";
import { listRegistrations } from "@/lib/registrations";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export default async function VehicleRegistrationsPage() {
  const session = await requireSignedIn();
  const identity = await resolveFreshIdentity(session.user.discordId);
  if (!canViewModules(identity)) redirect("/overview");

  const { total, items } = await listRegistrations({
    kind: RegistrationKind.VEHICLE,
    limit: 100,
  });

  return (
    <RegistrationsRegistry
      title="Регистрации ТС"
      description="Реестр заявок на регистрацию транспорта."
      emptyHint={
        <>
          Заявок пока нет. Подача через команду <code>/регистрация-тс</code> в Discord.
        </>
      }
      showPlate
      detailLabel="Модель"
      total={total}
      items={items}
    />
  );
}

import { canManageModules, listVehicleCatalog } from "@mirror/core";
import { VehicleCatalog } from "@/components/vehicle-catalog";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Каталог ТС" };

export default async function CatalogPage() {
  const session = await requireSignedIn();
  const [identity, models] = await Promise.all([
    resolveFreshIdentity(session.user.discordId),
    listVehicleCatalog(),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Каталог ТС</h1>
        <p className="muted">
          Справочник моделей транспорта. Название можно скопировать и вставить в{" "}
          <code>/регистрация-тс</code>. Моделей в каталоге: {models.length.toLocaleString("ru-RU")}.
        </p>
      </div>
      <VehicleCatalog
        canEdit={canManageModules(identity)}
        models={models.map((model) => ({
          id: model.id,
          name: model.name,
          brand: model.brand,
          year: model.year,
          imageFileId: model.imageFileId,
        }))}
      />
    </div>
  );
}

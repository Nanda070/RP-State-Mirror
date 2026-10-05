import { canManageModules, listVehicleCatalog } from "@mirror/core";
import { VehicleCatalog } from "@/components/vehicle-catalog";
import { openSectionIdentity } from "@/lib/session";

export const metadata = { title: "Каталог ТС" };

export default async function CatalogPage() {
  const [identity, models] = await Promise.all([openSectionIdentity(), listVehicleCatalog()]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Каталог ТС</h1>
        <p className="muted">
          Справочник моделей транспорта. Моделей в каталоге: {models.length.toLocaleString("ru-RU")}.
        </p>
      </div>
      <VehicleCatalog
        canEdit={identity ? canManageModules(identity) : false}
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

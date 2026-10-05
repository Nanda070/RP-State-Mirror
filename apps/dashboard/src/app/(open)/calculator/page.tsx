import { canManageSystemSettings, listTransferRankRules } from "@mirror/core";
import { TransferCalculator } from "@/components/transfer-calculator";
import { getActiveFactionOptions } from "@/lib/catalog";
import { openSectionIdentity } from "@/lib/session";

export const metadata = { title: "Калькулятор переводов" };

export default async function CalculatorPage() {
  const [identity, factions, rules] = await Promise.all([
    openSectionIdentity(),
    getActiveFactionOptions(),
    listTransferRankRules(),
  ]);

  return (
    <div className="stack">
      <div className="section-head">
        <h1>Калькулятор переводов</h1>
        <p className="muted">
          Какой ранг вы получите при переводе в другую фракцию. По этой же таблице бот проверяет заявку в{" "}
          <code>/перевод-фракции</code>.
        </p>
      </div>
      <TransferCalculator factions={factions} rules={rules} canEdit={identity ? canManageSystemSettings(identity) : false} />
    </div>
  );
}

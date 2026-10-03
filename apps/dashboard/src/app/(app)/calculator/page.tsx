import { canManageSystemSettings, listTransferRankRules } from "@mirror/core";
import { TransferCalculator } from "@/components/transfer-calculator";
import { getActiveFactionOptions } from "@/lib/catalog";
import { requireSignedIn, resolveFreshIdentity } from "@/lib/session";

export const metadata = { title: "Калькулятор переводов" };

export default async function CalculatorPage() {
  const session = await requireSignedIn();
  const [identity, factions, rules] = await Promise.all([
    resolveFreshIdentity(session.user.discordId),
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
      <TransferCalculator factions={factions} rules={rules} canEdit={canManageSystemSettings(identity)} />
    </div>
  );
}

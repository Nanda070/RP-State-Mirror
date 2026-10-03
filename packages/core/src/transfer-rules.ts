/**
 * Transfer rank table (§5.3): pairwise rules «faction A, rank N → faction B, rank M».
 * A pair without rules does not restrict ranks; `/перевод-фракции` checks against this table
 * (see `assertTransferRanksAllowed`).
 */
import { RecordStatus, prisma } from "@mirror/db";
import { z } from "zod";
import { auditedMutation, type AuditContext } from "./audit.js";
import { UserError } from "./errors.js";

export const MAX_TRANSFER_RANK = 100;

export class TransferRuleError extends UserError {
  override name = "TransferRuleError";
}

const rankSchema = z.number().int().min(0).max(MAX_TRANSFER_RANK);

export const replaceTransferPairRulesSchema = z.object({
  fromFactionCode: z.string().trim().min(1).max(32),
  toFactionCode: z.string().trim().min(1).max(32),
  rules: z.array(z.object({ fromRank: rankSchema, toRank: rankSchema })).max(MAX_TRANSFER_RANK + 1),
});
export type ReplaceTransferPairRulesInput = z.input<typeof replaceTransferPairRulesSchema>;

export interface TransferRule {
  fromFactionCode: string;
  toFactionCode: string;
  fromRank: number;
  toRank: number;
}

export async function listTransferRankRules(
  filter: { fromFactionCode?: string | undefined; toFactionCode?: string | undefined } = {},
): Promise<TransferRule[]> {
  return prisma.transferRankRule.findMany({
    where: {
      status: RecordStatus.ACTIVE,
      ...(filter.fromFactionCode ? { fromFactionCode: filter.fromFactionCode.toUpperCase() } : {}),
      ...(filter.toFactionCode ? { toFactionCode: filter.toFactionCode.toUpperCase() } : {}),
    },
    orderBy: [{ fromFactionCode: "asc" }, { toFactionCode: "asc" }, { fromRank: "asc" }],
    select: { fromFactionCode: true, toFactionCode: true, fromRank: true, toRank: true },
  });
}

/** Target rank for a transfer, or `null` when the pair has no rule for this rank. */
export async function lookupTransferRank(
  fromFactionCode: string,
  toFactionCode: string,
  fromRank: number,
): Promise<number | null> {
  const rule = await prisma.transferRankRule.findFirst({
    where: {
      fromFactionCode: fromFactionCode.toUpperCase(),
      toFactionCode: toFactionCode.toUpperCase(),
      fromRank,
      status: RecordStatus.ACTIVE,
    },
    select: { toRank: true },
  });
  return rule?.toRank ?? null;
}

/**
 * Sets the whole rule table of one faction pair. Unchanged rules are kept, changed and removed ones
 * are archived, new ones are created — so history stays readable and nothing is physically deleted.
 */
export async function replaceTransferPairRules(input: ReplaceTransferPairRulesInput, context: AuditContext) {
  const data = replaceTransferPairRulesSchema.parse(input);
  const from = data.fromFactionCode.toUpperCase();
  const to = data.toFactionCode.toUpperCase();
  if (from === to) throw new TransferRuleError("Фракции «из» и «в» должны различаться.");

  const seen = new Set<number>();
  for (const rule of data.rules) {
    if (seen.has(rule.fromRank)) {
      throw new TransferRuleError(`Ранг ${rule.fromRank} фракции ${from} указан дважды.`);
    }
    seen.add(rule.fromRank);
  }

  return auditedMutation(context, "transfer_rules.replaced", "transfer_rank_rule", async (tx) => {
    const factions = await tx.faction.findMany({
      where: { code: { in: [from, to] }, status: RecordStatus.ACTIVE },
      select: { code: true },
    });
    for (const code of [from, to]) {
      if (!factions.some((faction) => faction.code === code)) {
        throw new TransferRuleError(`Фракция «${code}» не найдена или не активна.`);
      }
    }

    const existing = await tx.transferRankRule.findMany({
      where: { fromFactionCode: from, toFactionCode: to, status: RecordStatus.ACTIVE },
    });
    const wanted = new Map(data.rules.map((rule) => [rule.fromRank, rule.toRank]));
    const stale = existing.filter((rule) => wanted.get(rule.fromRank) !== rule.toRank);
    const kept = new Set(existing.filter((rule) => !stale.includes(rule)).map((rule) => rule.fromRank));

    // Archive first: the partial unique index allows one ACTIVE rule per (pair, fromRank).
    if (stale.length > 0) {
      await tx.transferRankRule.updateMany({
        where: { id: { in: stale.map((rule) => rule.id) } },
        data: { status: RecordStatus.ARCHIVED },
      });
    }
    const created = data.rules.filter((rule) => !kept.has(rule.fromRank));
    if (created.length > 0) {
      await tx.transferRankRule.createMany({
        data: created.map((rule) => ({ fromFactionCode: from, toFactionCode: to, ...rule })),
      });
    }

    const rules = [...data.rules].sort((a, b) => a.fromRank - b.fromRank);
    return {
      entityId: `${from}:${to}`,
      before: existing
        .map((rule) => ({ fromRank: rule.fromRank, toRank: rule.toRank }))
        .sort((a, b) => a.fromRank - b.fromRank),
      after: rules,
      result: rules.map((rule) => ({ fromFactionCode: from, toFactionCode: to, ...rule })),
    };
  });
}

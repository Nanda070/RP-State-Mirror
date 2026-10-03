"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Faction = { code: string; name: string; color: string | null };
type Rule = { fromFactionCode: string; toFactionCode: string; fromRank: number; toRank: number };
type DraftRow = { key: number; fromRank: string; toRank: string };

const MAX_RANK = 100;
let nextRowKey = 1;

function toDraft(rules: Rule[]): DraftRow[] {
  return rules.map((rule) => ({ key: nextRowKey++, fromRank: String(rule.fromRank), toRank: String(rule.toRank) }));
}

function parseRank(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const rank = Number(value);
  return rank <= MAX_RANK ? rank : null;
}

export function TransferCalculator({
  factions,
  rules,
  canEdit,
}: {
  factions: Faction[];
  rules: Rule[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(factions[0]?.code ?? "");
  const [to, setTo] = useState(factions[1]?.code ?? "");
  const [rank, setRank] = useState("");
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const pairRules = useMemo(
    () =>
      rules
        .filter((rule) => rule.fromFactionCode === from && rule.toFactionCode === to)
        .sort((a, b) => a.fromRank - b.fromRank),
    [rules, from, to],
  );
  const samePair = from !== "" && from === to;
  const wantedRank = parseRank(rank);
  const match = wantedRank === null ? undefined : pairRules.find((rule) => rule.fromRank === wantedRank);

  function selectPair(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    setDraft(null);
    setError(null);
    setSaved(false);
  }

  function fillOneToOne() {
    const answer = window.prompt("До какого ранга заполнить соответствие 1 → 1, 2 → 2, …?", "10");
    if (answer === null) return;
    const top = parseRank(answer);
    if (top === null || top < 1) {
      setError(`Введите число от 1 до ${MAX_RANK}.`);
      return;
    }
    setError(null);
    setDraft(
      Array.from({ length: top }, (_, index) => ({
        key: nextRowKey++,
        fromRank: String(index + 1),
        toRank: String(index + 1),
      })),
    );
  }

  async function save() {
    if (!draft) return;
    const parsed: { fromRank: number; toRank: number }[] = [];
    for (const row of draft) {
      const fromRank = parseRank(row.fromRank);
      const toRank = parseRank(row.toRank);
      if (fromRank === null || toRank === null) {
        setError(`Ранги — целые числа от 0 до ${MAX_RANK}. Проверьте строку «${row.fromRank || "?"} → ${row.toRank || "?"}».`);
        return;
      }
      parsed.push({ fromRank, toRank });
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/calculator", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromFactionCode: from, toFactionCode: to, rules: parsed }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Ошибка сохранения");
      setDraft(null);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setPending(false);
    }
  }

  if (factions.length < 2) {
    return (
      <div className="panel empty-state">
        <h2 className="panel-title">Недостаточно фракций</h2>
        <p className="muted">Для расчёта перевода нужны хотя бы две активные фракции.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="panel">
        <div className="form-grid-3">
          <div className="field">
            <label htmlFor="calcFrom">Из фракции</label>
            <select id="calcFrom" value={from} onChange={(event) => selectPair(event.target.value, to)}>
              {factions.map((faction) => (
                <option key={faction.code} value={faction.code}>
                  {faction.code} — {faction.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="calcTo">В фракцию</label>
            <select id="calcTo" value={to} onChange={(event) => selectPair(from, event.target.value)}>
              {factions.map((faction) => (
                <option key={faction.code} value={faction.code}>
                  {faction.code} — {faction.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="calcRank">Ваш текущий ранг</label>
            <input
              id="calcRank"
              inputMode="numeric"
              placeholder="Например, 5"
              value={rank}
              onChange={(event) => setRank(event.target.value)}
            />
          </div>
        </div>

        {samePair ? (
          <p className="form-error">Выберите две разные фракции.</p>
        ) : pairRules.length === 0 ? (
          <p className="muted calc-result">
            Для перевода <strong>{from} → {to}</strong> таблица не заполнена: ранг при переводе согласуется с
            лидерами, бот его не проверяет.
          </p>
        ) : rank.trim() === "" ? (
          <p className="muted calc-result">Введите текущий ранг, чтобы увидеть ранг после перевода.</p>
        ) : match ? (
          <p className="calc-result calc-result-ok">
            Ранг <strong>{match.fromRank}</strong> в {from} соответствует рангу <strong>{match.toRank}</strong> в{" "}
            {to}.
          </p>
        ) : (
          <p className="form-error">
            Для ранга «{rank.trim()}» правила нет: перевод {from} → {to} с этого ранга не предусмотрен.
          </p>
        )}
      </div>

      {!samePair ? (
        <div className="panel">
          <div className="row calc-table-head">
            <h2 className="panel-title">
              Таблица {from} → {to}
            </h2>
            {canEdit && !draft ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setSaved(false);
                  setError(null);
                  setDraft(toDraft(pairRules));
                }}
              >
                Редактировать
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {saved && !draft ? <p className="form-ok">Таблица сохранена.</p> : null}

          {draft ? (
            <div className="stack">
              {draft.length === 0 ? (
                <p className="muted">
                  Правил нет. Пустая таблица означает перевод без проверки ранга.
                </p>
              ) : (
                <div className="calc-edit-rows">
                  {draft.map((row) => (
                    <div key={row.key} className="calc-edit-row">
                      <input
                        aria-label={`Ранг в ${from}`}
                        inputMode="numeric"
                        value={row.fromRank}
                        onChange={(event) =>
                          setDraft(draft.map((r) => (r.key === row.key ? { ...r, fromRank: event.target.value } : r)))
                        }
                      />
                      <span aria-hidden>→</span>
                      <input
                        aria-label={`Ранг в ${to}`}
                        inputMode="numeric"
                        value={row.toRank}
                        onChange={(event) =>
                          setDraft(draft.map((r) => (r.key === row.key ? { ...r, toRank: event.target.value } : r)))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setDraft(draft.filter((r) => r.key !== row.key))}
                      >
                        Убрать
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDraft([...draft, { key: nextRowKey++, fromRank: "", toRank: "" }])}
                >
                  Добавить правило
                </button>
                <button type="button" className="btn btn-secondary" onClick={fillOneToOne}>
                  Заполнить 1 → 1
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setDraft([])}>
                  Очистить
                </button>
              </div>
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void save()}>
                  {pending ? "Сохранение…" : "Сохранить таблицу"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pending}
                  onClick={() => {
                    setDraft(null);
                    setError(null);
                  }}
                >
                  Отмена
                </button>
              </div>
            </div>
          ) : pairRules.length === 0 ? (
            <p className="muted u-m0">
              Правил для этой пары нет.
            </p>
          ) : (
            <div className="registry-table-wrap">
              <table className="registry-table">
                <thead>
                  <tr>
                    <th>Ранг в {from}</th>
                    <th>Ранг в {to}</th>
                  </tr>
                </thead>
                <tbody>
                  {pairRules.map((rule) => (
                    <tr key={rule.fromRank} data-highlight={rule.fromRank === wantedRank ? "" : undefined}>
                      <td>{rule.fromRank}</td>
                      <td>{rule.toRank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

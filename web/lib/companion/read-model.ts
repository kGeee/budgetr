// Builds the DesktopReadModel snapshot that @budgetr/core.buildSummary turns
// into the phone's Summary. This is the only file that knows how budgetr's
// dollars-as-REAL schema maps onto the contract's integer cents.
//
// Conventions bridged here:
//  - budgetr stores dollars (floats); contracts want integer cents → ×100, round.
//  - transactions.amount is Plaid-signed (positive = outflow); the contract
//    wants outflow NEGATIVE → negate.
//  - credit/loan balances are positive amounts owed; the contract wants
//    liabilities negative → negate.
//  - positions carry ONLY symbol + market value (buildSummary strips the rest,
//    and the core validator hard-rejects anything extra — basis never leaves).

import type { DesktopReadModel } from "@budgetr/core";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  getAccounts,
  getBudgetsWithSpend,
  getDailySpend,
  getHoldings,
  getInvestmentSectors,
  getManualHoldings,
  getNetWorth,
  getNetWorthSeries,
  getRecentTransactions,
  sectorKeyFor,
} from "@/lib/queries";
import { detectAnomalies, type Alert } from "@/lib/anomalies";
import { classifyOptionLegs, parseOccSymbol, type OptionLegInput, type ParsedOption } from "@/lib/options";
import { getAppliedOpIds } from "./store";

const cents = (dollars: number | null | undefined): number => Math.round((dollars ?? 0) * 100);

const dayToUnix = (yyyyMmDd: string): number => Math.floor(Date.parse(`${yyyyMmDd}T00:00:00Z`) / 1000);

const ACCOUNT_KINDS = new Set(["depository", "credit", "investment", "loan"]);
const LIABILITY_KINDS = new Set(["credit", "loan"]);

function alertKind(kind: Alert["kind"]): "overspend" | "large_move" | "low_balance" | "other" {
  return kind === "spike" ? "large_move" : "other";
}

export function buildReadModel(now = Math.floor(Date.now() / 1000)): DesktopReadModel {
  const accounts = getAccounts()
    .filter((a) => !a.excluded)
    .map((a) => {
      const kind = (ACCOUNT_KINDS.has(a.type) ? a.type : "other") as DesktopReadModel["accounts"][number]["kind"];
      const sign = LIABILITY_KINDS.has(a.type) ? -1 : 1;
      return { id: a.id, name: a.name, kind, cents: sign * cents(a.currentBalance) };
    });

  // Only categories with an actual budget become BudgetSummaries — the phone's
  // Budgets screen is bars-with-limits, not the full category list.
  const budgets = getBudgetsWithSpend()
    .filter((b) => b.budget != null && b.budget > 0)
    .map((b) => ({ category: b.categoryId, spentCents: cents(b.spent), limitCents: cents(b.budget) }));

  const transactions = getRecentTransactions(40).map((t) => ({
    id: t.id,
    ts: dayToUnix(t.date),
    merchant: t.displayName,
    cents: -cents(t.amount), // Plaid positive-outflow → contract negative-outflow
    category: t.categoryId ?? "uncategorized",
    pending: t.pending,
  }));

  // Positions: Plaid holdings aggregated by ticker (option legs fold into
  // their underlying — exposure per name), plus manual holdings that carry a
  // user-entered value. Symbol-less rows fold into their name.
  const holdings = getHoldings();
  const manual = getManualHoldings();
  const bySymbol = new Map<string, number>();
  const optionLegs: Array<{ parsed: ParsedOption; quantity: number | null; valueCents: number }> = [];
  for (const h of holdings) {
    if (h.value == null || h.value === 0) continue;
    const parsed = parseOccSymbol(h.ticker);
    if (parsed) optionLegs.push({ parsed, quantity: h.quantity, valueCents: cents(h.value) });
    const symbol = parsed?.underlying ?? h.ticker ?? h.securityName ?? "OTHER";
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + cents(h.value));
  }
  for (const m of manual) {
    if (m.manualValue == null || m.manualValue === 0) continue;
    const symbol = m.symbol ?? m.name ?? "OTHER";
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + cents(m.manualValue));
  }
  const positions = [...bySymbol.entries()].map(([symbol, value]) => ({ symbol, cents: value }));

  const investments = buildInvestmentsModel(holdings, manual, optionLegs, now);

  // detectAnomalies already excludes dismissed/snoozed alert keys.
  const alerts = detectAnomalies().map((a) => ({
    id: a.key,
    kind: alertKind(a.kind),
    text: a.detail ? `${a.title} — ${a.detail}` : a.title,
    ts: a.date ? dayToUnix(a.date) : now,
  }));

  return {
    now,
    appliedOpIds: getAppliedOpIds(),
    netWorthCents: cents(getNetWorth().net),
    netWorthSpark: getNetWorthSeries().map((p) => ({ d: dayToUnix(p.date), cents: cents(p.netWorth) })),
    accounts,
    budgets,
    transactions,
    positions,
    alerts,
    investments,
    spendByDay: getDailySpend(92).map((r) => ({ d: dayToUnix(r.date), cents: cents(r.spent) })),
  };
}

/**
 * The optional investments block: portfolio value + spark (investment
 * accounts' balance snapshots), sector allocation via the user's
 * investment_sectors assignments, and topical options strategies via the
 * desktop's own OCC parsing + leg classification. Only pre-rendered labels
 * and market values leave here — never basis, greeks, or payoff math.
 */
function buildInvestmentsModel(
  holdings: ReturnType<typeof getHoldings>,
  manual: ReturnType<typeof getManualHoldings>,
  optionLegs: Array<{ parsed: ParsedOption; quantity: number | null; valueCents: number }>,
  now: number,
): DesktopReadModel["investments"] {
  const sectorNames = getInvestmentSectors();
  const bySector = new Map<string, number>();
  const addToSector = (key: string, valueCents: number) => {
    const name = sectorNames[key] ?? "Unclassified";
    bySector.set(name, (bySector.get(name) ?? 0) + valueCents);
  };
  let valueCents = 0;
  for (const h of holdings) {
    if (h.value == null || h.value === 0) continue;
    valueCents += cents(h.value);
    const parsed = parseOccSymbol(h.ticker);
    addToSector(sectorKeyFor(parsed?.underlying ?? h.ticker, h.id), cents(h.value));
  }
  for (const m of manual) {
    if (m.manualValue == null || m.manualValue === 0) continue;
    valueCents += cents(m.manualValue);
    addToSector(sectorKeyFor(m.symbol, `man:${m.id}`), cents(m.manualValue));
  }

  // Strategies: group legs per underlying, let the desktop's classifier name
  // them, value each structure at the sum of its legs' market values.
  const legsByUnderlying = new Map<string, Array<{ parsed: ParsedOption; quantity: number | null; valueCents: number }>>();
  for (const leg of optionLegs) {
    const arr = legsByUnderlying.get(leg.parsed.underlying);
    if (arr) arr.push(leg);
    else legsByUnderlying.set(leg.parsed.underlying, [leg]);
  }
  const strategies: NonNullable<DesktopReadModel["investments"]>["strategies"] = [];
  for (const [underlying, legs] of legsByUnderlying) {
    const inputs: OptionLegInput[] = legs.map((l) => ({ parsed: l.parsed, quantity: l.quantity }));
    for (const structure of classifyOptionLegs(inputs)) {
      const legCents = structure.legIndexes.reduce((acc, i) => acc + (legs[i]?.valueCents ?? 0), 0);
      const expiryIso = legs[structure.legIndexes[0]!]?.parsed.expiry;
      if (!expiryIso) continue;
      const expiry = dayToUnix(expiryIso);
      if (expiry < now - 86_400) continue; // expired structures aren't topical
      strategies.push({
        id: `${underlying}:${expiryIso}:${structure.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        underlying,
        label: structure.label,
        detail: structure.detail,
        expiry,
        cents: legCents,
      });
    }
  }

  const spark = db
    .all<{ date: string; v: number }>(
      sql`SELECT date, SUM(balance) AS v FROM balance_snapshots
          WHERE type = 'investment'
          GROUP BY date ORDER BY date ASC`,
    )
    .map((r) => ({ d: dayToUnix(r.date), cents: cents(Number(r.v)) }));

  return {
    valueCents,
    spark,
    sectors: [...bySector.entries()].map(([sector, c]) => ({ sector, cents: c })),
    strategies,
  };
}

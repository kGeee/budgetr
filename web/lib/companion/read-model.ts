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
import { payoffCurve } from "@/lib/payoff";
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
  // user-entered value. Each position also gets pre-rendered display fields:
  // name, value-weighted day move, aggregate P&L (only when EVERY row of the
  // symbol has a recorded basis — partial P&L would lie), quantity, sector.
  const holdings = getHoldings();
  const manual = getManualHoldings();
  const sectorNamesForPositions = getInvestmentSectors();
  type PosAcc = {
    cents: number;
    name: string | null;
    qty: number | null; // null once options mix in — a share count would mislead
    pnl: number; // dollars; valid only while costed stays true
    costed: boolean;
    dayNow: number; // Σ qty·price   (rows with both prices)
    dayClose: number; // Σ qty·close
    sector: string | null;
  };
  const bySymbol = new Map<string, PosAcc>();
  const acc = (symbol: string): PosAcc => {
    let a = bySymbol.get(symbol);
    if (!a) {
      a = { cents: 0, name: null, qty: null, pnl: 0, costed: true, dayNow: 0, dayClose: 0, sector: null };
      bySymbol.set(symbol, a);
    }
    return a;
  };
  const optionLegs: Array<{ parsed: ParsedOption; quantity: number | null; valueCents: number; costBasis: number | null }> = [];
  for (const h of holdings) {
    if (h.value == null || h.value === 0) continue;
    const parsed = parseOccSymbol(h.ticker);
    if (parsed) optionLegs.push({ parsed, quantity: h.quantity, valueCents: cents(h.value), costBasis: h.costBasis ?? null });
    const symbol = parsed?.underlying ?? h.ticker ?? h.securityName ?? "OTHER";
    const a = acc(symbol);
    a.cents += cents(h.value);
    if (parsed) {
      a.qty = null; // options in the mix — suppress the share count
    } else {
      a.name ??= h.securityName ?? null;
      if (h.quantity != null) a.qty = (a.qty ?? 0) + h.quantity;
      if (h.price != null && h.closePrice != null && h.quantity != null) {
        a.dayNow += h.quantity * h.price;
        a.dayClose += h.quantity * h.closePrice;
      }
    }
    if (h.costBasis == null) a.costed = false;
    else a.pnl += h.value - h.costBasis;
    a.sector ??= sectorNamesForPositions[sectorKeyFor(parsed?.underlying ?? h.ticker, h.id)] ?? null;
  }
  for (const m of manual) {
    if (m.manualValue == null || m.manualValue === 0) continue;
    const symbol = m.symbol ?? m.name ?? "OTHER";
    const a = acc(symbol);
    a.cents += cents(m.manualValue);
    a.name ??= m.name ?? null;
    if (m.quantity != null) a.qty = (a.qty ?? 0) + m.quantity;
    if (m.costBasis == null) a.costed = false;
    else a.pnl += m.manualValue - m.costBasis;
    a.sector ??= sectorNamesForPositions[sectorKeyFor(m.symbol, `man:${m.id}`)] ?? null;
  }
  const positions = [...bySymbol.entries()].map(([symbol, a]) => ({
    symbol,
    cents: a.cents,
    ...(a.name ? { name: a.name } : {}),
    ...(a.dayClose > 0 ? { dayBp: Math.round(((a.dayNow - a.dayClose) / a.dayClose) * 10_000) } : {}),
    ...(a.costed ? { pnlCents: cents(a.pnl) } : {}),
    ...(a.qty != null ? { qtyLabel: a.qty.toLocaleString("en-US", { maximumFractionDigits: 4 }) } : {}),
    ...(a.sector ? { sector: a.sector } : {}),
  }));

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
  optionLegs: Array<{ parsed: ParsedOption; quantity: number | null; valueCents: number; costBasis: number | null }>,
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
  const legsByUnderlying = new Map<
    string,
    Array<{ parsed: ParsedOption; quantity: number | null; valueCents: number; costBasis: number | null }>
  >();
  for (const leg of optionLegs) {
    const arr = legsByUnderlying.get(leg.parsed.underlying);
    if (arr) arr.push(leg);
    else legsByUnderlying.set(leg.parsed.underlying, [leg]);
  }
  const strategies: NonNullable<DesktopReadModel["investments"]>["strategies"] = [];
  for (const [underlying, legs] of legsByUnderlying) {
    const inputs: OptionLegInput[] = legs.map((l) => ({ parsed: l.parsed, quantity: l.quantity, costBasis: l.costBasis }));
    for (const structure of classifyOptionLegs(inputs)) {
      const legCents = structure.legIndexes.reduce((acc, i) => acc + (legs[i]?.valueCents ?? 0), 0);
      const expiryIso = legs[structure.legIndexes[0]!]?.parsed.expiry;
      if (!expiryIso) continue;
      const expiry = dayToUnix(expiryIso);
      if (expiry < now - 86_400) continue; // expired structures aren't topical

      // Pre-render the payoff outputs for the phone — only when every leg has
      // a recorded premium, so the curve is real P&L, never zero-premium noise.
      const allCosted = structure.legIndexes.every((i) => legs[i]?.costBasis != null);
      const curvePoints =
        allCosted && structure.payoffLegs?.length
          ? payoffCurve(structure.payoffLegs).points.map((pt) => ({ p: pt.price * 100, pnl: pt.pnl * 100 }))
          : undefined;

      strategies.push({
        id: `${underlying}:${expiryIso}:${structure.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        underlying,
        label: structure.label,
        detail: structure.detail,
        expiry,
        cents: legCents,
        ...(curvePoints ? { curve: curvePoints } : {}),
        ...(allCosted && structure.breakevens?.length ? { breakevens: structure.breakevens.map((b) => b * 100) } : {}),
        ...(allCosted
          ? {
              maxProfitCents: structure.maxProfitUnbounded ? null : structure.maxProfit != null ? structure.maxProfit * 100 : undefined,
              maxLossCents: structure.maxLossUnbounded ? null : structure.maxLoss != null ? structure.maxLoss * 100 : undefined,
            }
          : {}),
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

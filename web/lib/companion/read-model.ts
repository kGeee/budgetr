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
import {
  getAccounts,
  getBudgetsWithSpend,
  getHoldings,
  getManualHoldings,
  getNetWorth,
  getNetWorthSeries,
  getRecentTransactions,
} from "@/lib/queries";
import { detectAnomalies, type Alert } from "@/lib/anomalies";
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

  // Positions: Plaid holdings aggregated by ticker, plus manual holdings that
  // carry a user-entered value. Symbol-less rows fold into their name.
  const bySymbol = new Map<string, number>();
  for (const h of getHoldings()) {
    if (h.value == null || h.value === 0) continue;
    const symbol = h.ticker ?? h.securityName ?? "OTHER";
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + cents(h.value));
  }
  for (const m of getManualHoldings()) {
    if (m.manualValue == null || m.manualValue === 0) continue;
    const symbol = m.symbol ?? m.name ?? "OTHER";
    bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + cents(m.manualValue));
  }
  const positions = [...bySymbol.entries()].map(([symbol, value]) => ({ symbol, cents: value }));

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
  };
}

/**
 * Dividend income derivation (pure, no DB).
 *
 * Consumes the raw investmentTransactions ledger and folds the cash-dividend
 * rows into an income stream: trailing income by month and by ticker, a
 * yield-on-cost per position (trailing-12m dividends ÷ cost basis), and a
 * projected forward annual income (the trailing payment cadence annualized).
 *
 * A row counts as dividend income when its subtype/name reads like a dividend
 * and it's a *cash distribution* (no share quantity) — reinvestment buys carry a
 * quantity and represent a share purchase, not income, so they're excluded to
 * avoid double-counting. Plaid records cash inflows as a negative `amount`
 * (matching the tax-lots convention), so the payment magnitude is |amount|.
 *
 * Everything is derived from the ledger + holdings cost basis alone, so this
 * stays deterministic and unit-testable — the query layer (lib/queries.ts) is
 * the only place that reads the DB and feeds rows in here.
 */

/** Minimal shape this module needs from a getInvestmentTransactions() row. */
export type DividendLedgerTxn = {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  type: string | null;
  subtype: string | null;
  quantity: number | null;
  amount: number | null;
  ticker: string | null;
  securityName: string | null;
  currency: string | null;
};

/** Cost basis for one position, keyed by ticker (from getHoldings()). */
export type DividendHolding = {
  ticker: string | null;
  costBasis: number | null;
};

/** A single classified dividend payment, amount normalized to a positive figure. */
export type DividendPayment = {
  id: string;
  date: string; // YYYY-MM-DD
  ticker: string | null;
  name: string | null;
  amount: number; // positive income magnitude
  currency: string;
};

/** Rolled-up dividend history + forward projection for one ticker. */
export type TickerDividend = {
  ticker: string;
  name: string | null;
  /** Sum of dividends received in the trailing 365 days. */
  trailing12m: number;
  /** All-time dividends received. */
  lifetime: number;
  /** Payments in the trailing 365 days. */
  count12m: number;
  lastPaid: string | null;
  lastAmount: number | null;
  /** Position cost basis (matched from holdings), or null when unheld/uncosted. */
  costBasis: number | null;
  /** trailing12m ÷ costBasis × 100, or null without a positive basis. */
  yieldOnCost: number | null;
  /** Forward annual income: last payment × inferred payments/yr (0 when stale). */
  projectedAnnual: number;
  currency: string;
};

export type DividendSummary = {
  /** Every classified payment, newest first. */
  payments: DividendPayment[];
  /** Income per calendar month, gap-filled, oldest first. */
  byMonth: { month: string; amount: number }[];
  /** Per-ticker rollup, ranked by trailing-12m income. */
  byTicker: TickerDividend[];
  /** Sum of all trailing-12m dividends. */
  trailing12mTotal: number;
  /** Sum of every ticker's projected forward annual income. */
  projectedAnnualTotal: number;
  /** All-time dividends received. */
  lifetimeTotal: number;
  /** Trailing-12m income ÷ cost basis of the paying positions, ×100. */
  portfolioYieldOnCost: number | null;
};

const DAY_MS = 86_400_000;

/** True when a ledger row is a cash dividend distribution (not a reinvestment buy). */
export function isDividendTxn(t: DividendLedgerTxn): boolean {
  const hay = `${t.subtype ?? ""} ${t.name ?? ""}`.toLowerCase();
  const looksDividend = /\bdiv(idend)?\b/.test(hay);
  if (!looksDividend) return false;
  // Reinvestment buys carry a share quantity — they're a purchase, not income.
  const isCashDistribution = t.type === "cash" || t.quantity == null || t.quantity === 0;
  return isCashDistribution && t.amount != null && t.amount !== 0;
}

/** Extract the dividend payments from a raw ledger, amounts normalized positive. */
export function classifyDividends(txns: DividendLedgerTxn[]): DividendPayment[] {
  return txns
    .filter(isDividendTxn)
    .map((t) => ({
      id: t.id,
      date: t.date,
      ticker: t.ticker ? t.ticker.toUpperCase() : null,
      name: t.securityName ?? t.name ?? null,
      amount: Math.abs(t.amount ?? 0),
      currency: t.currency ?? "USD",
    }));
}

/** Inclusive list of 'YYYY-MM' months from `start` to `end`. */
function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Income per calendar month, gap-filled from the first payment through `now`. */
function incomeByMonth(payments: DividendPayment[], now: Date): { month: string; amount: number }[] {
  if (payments.length === 0) return [];
  const totals = new Map<string, number>();
  let earliest = payments[0].date.slice(0, 7);
  for (const p of payments) {
    const month = p.date.slice(0, 7);
    if (month < earliest) earliest = month;
    totals.set(month, (totals.get(month) ?? 0) + p.amount);
  }
  const nowMonth = now.toISOString().slice(0, 7);
  const last = nowMonth > earliest ? nowMonth : earliest;
  return monthRange(earliest, last).map((month) => ({ month, amount: totals.get(month) ?? 0 }));
}

/**
 * Payments per year inferred from the median gap between consecutive payments,
 * snapped to the standard cadences (monthly / quarterly / semiannual / annual).
 * Returns null when there aren't at least two payments to measure a gap.
 */
function inferPaymentsPerYear(datesAsc: string[]): number | null {
  if (datesAsc.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < datesAsc.length; i++) {
    gaps.push((Date.parse(datesAsc[i]) - Date.parse(datesAsc[i - 1])) / DAY_MS);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median <= 45) return 12; // monthly
  if (median <= 135) return 4; // quarterly
  if (median <= 270) return 2; // semiannual
  return 1; // annual
}

/**
 * Stitch a ledger + holdings cost basis into the full dividend summary. `now`
 * is injectable for testing; production passes the current date.
 */
export function buildDividendSummary(
  txns: DividendLedgerTxn[],
  holdings: DividendHolding[],
  now: Date = new Date(),
): DividendSummary {
  const payments = classifyDividends(txns);
  // Newest first for display; per-ticker math sorts its own slice ascending.
  payments.sort((a, b) => b.date.localeCompare(a.date));

  const costByTicker = new Map<string, number>();
  for (const h of holdings) {
    if (!h.ticker || h.costBasis == null) continue;
    const sym = h.ticker.toUpperCase();
    costByTicker.set(sym, (costByTicker.get(sym) ?? 0) + h.costBasis);
  }

  const cutoff12m = now.getTime() - 365 * DAY_MS;
  const active = now.getTime() - 400 * DAY_MS; // still-paying if a payment is this recent

  // Group tickered payments (untickered cash dividends still count toward totals
  // but can't be attributed to a position or yield).
  const byTickerMap = new Map<string, DividendPayment[]>();
  for (const p of payments) {
    if (!p.ticker) continue;
    const arr = byTickerMap.get(p.ticker);
    if (arr) arr.push(p);
    else byTickerMap.set(p.ticker, [p]);
  }

  const byTicker: TickerDividend[] = [];
  for (const [ticker, ps] of byTickerMap) {
    const asc = [...ps].sort((a, b) => a.date.localeCompare(b.date));
    const lifetime = asc.reduce((s, p) => s + p.amount, 0);
    const recent = asc.filter((p) => Date.parse(p.date) >= cutoff12m);
    const trailing12m = recent.reduce((s, p) => s + p.amount, 0);
    const lastPayment = asc[asc.length - 1];
    const costBasis = costByTicker.get(ticker) ?? null;
    const yieldOnCost =
      costBasis != null && costBasis > 0 ? (trailing12m / costBasis) * 100 : null;

    // Forward run-rate: only project positions that paid within the last ~400d.
    let projectedAnnual = 0;
    if (Date.parse(lastPayment.date) >= active) {
      const ppy = inferPaymentsPerYear(asc.map((p) => p.date));
      // With only one payment on record we can't infer a cadence, so fall back
      // to the trailing-12m figure rather than inventing a multiplier.
      projectedAnnual = ppy != null ? lastPayment.amount * ppy : trailing12m;
    }

    byTicker.push({
      ticker,
      name: lastPayment.name,
      trailing12m,
      lifetime,
      count12m: recent.length,
      lastPaid: lastPayment.date,
      lastAmount: lastPayment.amount,
      costBasis,
      yieldOnCost,
      projectedAnnual,
      currency: lastPayment.currency,
    });
  }
  byTicker.sort((a, b) => b.trailing12m - a.trailing12m || b.lifetime - a.lifetime);

  const trailing12mTotal = payments
    .filter((p) => Date.parse(p.date) >= cutoff12m)
    .reduce((s, p) => s + p.amount, 0);
  const lifetimeTotal = payments.reduce((s, p) => s + p.amount, 0);
  const projectedAnnualTotal = byTicker.reduce((s, t) => s + t.projectedAnnual, 0);

  // Portfolio yield-on-cost only over positions we actually hold with a basis.
  let costOfPayers = 0;
  let incomeOfPayers = 0;
  for (const t of byTicker) {
    if (t.costBasis != null && t.costBasis > 0) {
      costOfPayers += t.costBasis;
      incomeOfPayers += t.trailing12m;
    }
  }
  const portfolioYieldOnCost = costOfPayers > 0 ? (incomeOfPayers / costOfPayers) * 100 : null;

  return {
    payments,
    byMonth: incomeByMonth(payments, now),
    byTicker,
    trailing12mTotal,
    projectedAnnualTotal,
    lifetimeTotal,
    portfolioYieldOnCost,
  };
}

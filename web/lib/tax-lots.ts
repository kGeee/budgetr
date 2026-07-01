/**
 * Cost-basis lot reconstruction + realized P&L (pure, no DB).
 *
 * Consumes the raw investmentTransactions buy/sell ledger and rebuilds the
 * per-ticker lots that a brokerage would track internally, then matches each
 * sell against open buy lots to produce realized gain/loss rows. Matching order
 * is configurable per ticker: FIFO (default), LIFO, or manual spec-ID (a set of
 * pinned sell→buy lot assignments, falling back to FIFO for the remainder).
 *
 * Every figure is derived from the ledger alone so this stays deterministic and
 * unit-testable — the query layer (lib/queries.ts) is the only place that reads
 * the DB and feeds rows/config in here.
 */

export type CostBasisMethod = "FIFO" | "LIFO" | "specid";
export type Term = "short" | "long";

/** Minimal shape this module needs from a getInvestmentTransactions() row. */
export type LedgerTxn = {
  id: string;
  date: string; // YYYY-MM-DD
  type: string | null; // buy | sell | ...
  quantity: number | null; // + buy, - sell
  amount: number | null; // + cash out (buy), - cash in (sell)
  price: number | null;
  fees: number | null;
  ticker: string | null;
};

/** One manual spec-ID assignment (from the taxLotOverrides table). */
export type LotOverride = {
  sellTxnId: string;
  buyTxnId: string;
  quantity: number;
};

/** A single closed lot: one sell matched against one buy, with its P&L. */
export type RealizedLot = {
  ticker: string;
  openDate: string; // buy date
  closeDate: string; // sell date
  quantity: number; // shares closed in this match
  proceeds: number; // sale proceeds allocated to these shares (net of fees)
  basis: number; // cost basis of these shares (incl. buy fees)
  gain: number; // proceeds - basis
  term: Term; // held > 365 calendar days → long
  washSale: boolean; // realized loss with a same-ticker buy within ±30 days
  sellTxnId: string;
  buyTxnId: string;
};

export type YearSummary = {
  year: number;
  shortTerm: number; // net short-term gain/loss
  longTerm: number; // net long-term gain/loss
  total: number; // shortTerm + longTerm
  proceeds: number;
  basis: number;
  disallowedWash: number; // sum of losses disallowed by the wash-sale rule (positive $)
  lots: number; // count of realized lots
};

const DAY_MS = 86_400_000;
const LONG_TERM_DAYS = 365;
const WASH_WINDOW_DAYS = 30;

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  return Math.round((db - da) / DAY_MS);
}

/** True for a buy (opens/adds to a lot). Prefers `type`, falls back to sign. */
function isBuy(t: LedgerTxn): boolean {
  if (t.type === "buy") return true;
  if (t.type === "sell") return false;
  return (t.quantity ?? 0) > 0;
}
function isSell(t: LedgerTxn): boolean {
  if (t.type === "sell") return true;
  if (t.type === "buy") return false;
  return (t.quantity ?? 0) < 0;
}

/** Total cash basis of a buy incl. fees (falls back to price×qty + fees). */
function buyCostTotal(t: LedgerTxn, qty: number): number {
  if (t.amount != null) return Math.abs(t.amount); // Plaid buy amount already nets fees in
  return (t.price ?? 0) * qty + (t.fees ?? 0);
}

/** Total proceeds of a sell net of fees (falls back to price×qty − fees). */
function sellProceedsTotal(t: LedgerTxn, qty: number): number {
  if (t.amount != null) return Math.abs(t.amount); // Plaid sell amount already nets fees out
  return (t.price ?? 0) * qty - (t.fees ?? 0);
}

type OpenLot = {
  buyTxnId: string;
  date: string;
  remaining: number; // shares still open
  costPerShare: number;
};

/**
 * Resolve the effective method for a ticker: `sym:<TICKER>` scope → `*` global
 * scope → FIFO default. `methods` keys mirror the costBasisMethod table.
 */
export function methodForTicker(
  methods: Record<string, string>,
  ticker: string,
): CostBasisMethod {
  const raw = methods[`sym:${ticker.toUpperCase()}`] ?? methods["*"] ?? "FIFO";
  return raw === "LIFO" || raw === "specid" ? raw : "FIFO";
}

/**
 * Reconstruct realized lots from the ledger. `methods` selects the matching
 * strategy per ticker; `overrides` pins specific sell→buy matches (only honored
 * when the ticker's method is `specid`). Returned lots are sorted by close date
 * descending (newest realizations first).
 */
export function computeRealizedLots(
  txns: LedgerTxn[],
  methods: Record<string, string> = {},
  overrides: LotOverride[] = [],
): RealizedLot[] {
  // Group by ticker; ignore cash-only / untickered activity.
  const byTicker = new Map<string, LedgerTxn[]>();
  for (const t of txns) {
    if (!t.ticker) continue;
    if (!isBuy(t) && !isSell(t)) continue;
    if (!t.quantity || t.quantity === 0) continue;
    const key = t.ticker.toUpperCase();
    (byTicker.get(key) ?? byTicker.set(key, []).get(key)!).push(t);
  }

  // Spec-ID overrides indexed by sell txn.
  const overridesBySell = new Map<string, LotOverride[]>();
  for (const o of overrides) {
    (overridesBySell.get(o.sellTxnId) ?? overridesBySell.set(o.sellTxnId, []).get(o.sellTxnId)!).push(o);
  }

  const realized: RealizedLot[] = [];

  for (const [ticker, rows] of byTicker) {
    const method = methodForTicker(methods, ticker);
    // Chronological replay; stable within a day by original order.
    const ordered = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // All buy dates for this ticker drive wash-sale detection.
    const buyDates = ordered.filter(isBuy).map((t) => ({ id: t.id, date: t.date }));

    const open: OpenLot[] = [];

    for (const t of ordered) {
      if (isBuy(t)) {
        const qty = Math.abs(t.quantity ?? 0);
        if (qty === 0) continue;
        open.push({
          buyTxnId: t.id,
          date: t.date,
          remaining: qty,
          costPerShare: buyCostTotal(t, qty) / qty,
        });
        continue;
      }

      // Sell: allocate proceeds across the matched buy lots proportionally.
      let sellQty = Math.abs(t.quantity ?? 0);
      if (sellQty === 0) continue;
      const totalProceeds = sellProceedsTotal(t, sellQty);
      const proceedsPerShare = totalProceeds / sellQty;

      const takeFromLot = (lot: OpenLot, want: number) => {
        const take = Math.min(lot.remaining, want, sellQty);
        if (take <= 0) return 0;
        lot.remaining -= take;
        sellQty -= take;
        const proceeds = proceedsPerShare * take;
        const basis = lot.costPerShare * take;
        const gain = proceeds - basis;
        const heldDays = daysBetween(lot.date, t.date);
        const isLoss = gain < 0;
        const washSale =
          isLoss &&
          buyDates.some(
            (b) => b.id !== lot.buyTxnId && Math.abs(daysBetween(b.date, t.date)) <= WASH_WINDOW_DAYS,
          );
        realized.push({
          ticker,
          openDate: lot.date,
          closeDate: t.date,
          quantity: take,
          proceeds,
          basis,
          gain,
          term: heldDays > LONG_TERM_DAYS ? "long" : "short",
          washSale,
          sellTxnId: t.id,
          buyTxnId: lot.buyTxnId,
        });
        return take;
      };

      // 1) Honor explicit spec-ID pins first (specid method only).
      if (method === "specid") {
        for (const ov of overridesBySell.get(t.id) ?? []) {
          if (sellQty <= 0) break;
          const lot = open.find((l) => l.buyTxnId === ov.buyTxnId && l.remaining > 0);
          if (lot) takeFromLot(lot, ov.quantity);
        }
      }

      // 2) Fill any remainder by FIFO (specid fallback) / FIFO / LIFO order.
      const pool = open.filter((l) => l.remaining > 0);
      if (method === "LIFO") pool.reverse(); // latest lots first
      for (const lot of pool) {
        if (sellQty <= 0) break;
        takeFromLot(lot, lot.remaining);
      }
      // Any sellQty left over means an oversold/short position we can't basis —
      // silently ignored (no negative-basis phantom lots).
    }
  }

  realized.sort((a, b) => (a.closeDate < b.closeDate ? 1 : a.closeDate > b.closeDate ? -1 : 0));
  return realized;
}

/** Roll a set of realized lots into a single set of totals. */
export function summarize(lots: RealizedLot[]): Omit<YearSummary, "year"> {
  let shortTerm = 0;
  let longTerm = 0;
  let proceeds = 0;
  let basis = 0;
  let disallowedWash = 0;
  for (const l of lots) {
    if (l.term === "long") longTerm += l.gain;
    else shortTerm += l.gain;
    proceeds += l.proceeds;
    basis += l.basis;
    if (l.washSale && l.gain < 0) disallowedWash += -l.gain;
  }
  return {
    shortTerm,
    longTerm,
    total: shortTerm + longTerm,
    proceeds,
    basis,
    disallowedWash,
    lots: lots.length,
  };
}

/** Per-year capital-gains summary, newest year first. */
export function summarizeByYear(lots: RealizedLot[]): YearSummary[] {
  const byYear = new Map<number, RealizedLot[]>();
  for (const l of lots) {
    const year = Number(l.closeDate.slice(0, 4));
    (byYear.get(year) ?? byYear.set(year, []).get(year)!).push(l);
  }
  return [...byYear.entries()]
    .map(([year, ls]) => ({ year, ...summarize(ls) }))
    .sort((a, b) => b.year - a.year);
}

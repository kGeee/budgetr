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
  name?: string | null; // brokerage description; carries option open/close intent
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
  openDate: string; // date the long or written position opened
  closeDate: string; // date the position closed or expired
  quantity: number; // units closed in this match
  proceeds: number; // long sale proceeds or premium received for a written lot
  basis: number; // long purchase cost or cost to close a written lot
  gain: number; // proceeds - basis
  term: Term; // held > 365 calendar days → long
  washSale: boolean; // realized loss with a same-ticker buy within ±30 days
  position: "long" | "short"; // whether the closed lot was owned or written
  section1256: boolean; // broad-based index option; 60/40 tax character
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

/** Known OCC roots for listed, broad-based S&P 500 index options. */
export function isSection1256Ticker(ticker: string): boolean {
  return /^(?:SPX|SPXW|XSP)\d{6}[CP]\d{8}$/i.test(ticker.trim());
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  return Math.round((db - da) / DAY_MS);
}

/** Economic action represented by a brokerage ledger row. */
type TradeAction = "open-long" | "close-long" | "open-short" | "close-short" | null;

/**
 * Plaid flattens option activity to buy/sell, while the description preserves
 * the economically important open/close direction. Expirations arrive as
 * transfers: a negative quantity closes a long contract and a positive one
 * closes a written contract at zero value.
 */
export function tradeAction(t: LedgerTxn): TradeAction {
  const name = (t.name ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (name.includes("PURCHASETOOPEN") || name.includes("BUYTOOPEN")) return "open-long";
  if (name.includes("SOLDTOCLOSE") || name.includes("SELLTOCLOSE")) return "close-long";
  if (name.includes("SOLDTOOPEN") || name.includes("SELLTOOPEN")) return "open-short";
  if (name.includes("PURCHASETOCLOSE") || name.includes("BUYTOCLOSE")) return "close-short";
  if (name.includes("OPTIONEXPIRATION") || name.includes("OPTIONEXPIRED")) {
    return (t.quantity ?? 0) < 0 ? "close-long" : (t.quantity ?? 0) > 0 ? "close-short" : null;
  }
  if (t.type === "buy") return "open-long";
  if (t.type === "sell") return "close-long";
  return (t.quantity ?? 0) > 0 ? "open-long" : (t.quantity ?? 0) < 0 ? "close-long" : null;
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
  amountPerUnit: number; // long basis or short-sale proceeds
  position: "long" | "short";
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
    if (!tradeAction(t)) continue;
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
    const section1256 = isSection1256Ticker(ticker);
    // Chronological replay; stable within a day by original order.
    const ordered = [...rows].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      // Brokerage feeds often omit execution time. For an OCC contract opened
      // and closed on the same posted day, replay opening activity first.
      const opens = new Set<TradeAction>(["open-long", "open-short"]);
      return Number(opens.has(tradeAction(b))) - Number(opens.has(tradeAction(a)));
    });

    // All buy dates for this ticker drive wash-sale detection.
    const buyDates = ordered
      .filter((t) => tradeAction(t) === "open-long")
      .map((t) => ({ id: t.id, date: t.date }));

    const open: OpenLot[] = [];

    for (const t of ordered) {
      const action = tradeAction(t);
      if (action === "open-long" || action === "open-short") {
        const qty = Math.abs(t.quantity ?? 0);
        if (qty === 0) continue;
        open.push({
          buyTxnId: t.id,
          date: t.date,
          remaining: qty,
          amountPerUnit:
            (action === "open-long" ? buyCostTotal(t, qty) : sellProceedsTotal(t, qty)) / qty,
          position: action === "open-long" ? "long" : "short",
        });
        continue;
      }

      if (action !== "close-long" && action !== "close-short") continue;

      const closingPosition = action === "close-long" ? "long" : "short";
      let closeQty = Math.abs(t.quantity ?? 0);
      if (closeQty === 0) continue;
      const closeAmount =
        action === "close-long" ? sellProceedsTotal(t, closeQty) : buyCostTotal(t, closeQty);
      const closeAmountPerUnit = closeAmount / closeQty;

      const takeFromLot = (lot: OpenLot, want: number) => {
        if (lot.position !== closingPosition) return 0;
        const take = Math.min(lot.remaining, want, closeQty);
        if (take <= 0) return 0;
        lot.remaining -= take;
        closeQty -= take;
        const proceeds =
          closingPosition === "long" ? closeAmountPerUnit * take : lot.amountPerUnit * take;
        const basis =
          closingPosition === "long" ? lot.amountPerUnit * take : closeAmountPerUnit * take;
        const gain = proceeds - basis;
        const heldDays = daysBetween(lot.date, t.date);
        const isLoss = gain < 0;
        const washSale =
          !section1256 &&
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
          position: lot.position,
          section1256,
          sellTxnId: t.id,
          buyTxnId: lot.buyTxnId,
        });
        return take;
      };

      // 1) Honor explicit spec-ID pins first (specid method only).
      if (method === "specid") {
        for (const ov of overridesBySell.get(t.id) ?? []) {
          if (closeQty <= 0) break;
          const lot = open.find(
            (l) => l.buyTxnId === ov.buyTxnId && l.remaining > 0 && l.position === closingPosition,
          );
          if (lot) takeFromLot(lot, ov.quantity);
        }
      }

      // 2) Fill any remainder by FIFO (specid fallback) / FIFO / LIFO order.
      const pool = open.filter((l) => l.remaining > 0 && l.position === closingPosition);
      if (method === "LIFO") pool.reverse(); // latest lots first
      for (const lot of pool) {
        if (closeQty <= 0) break;
        takeFromLot(lot, lot.remaining);
      }
      // Any unmatched close is ignored: without its opening leg there is no
      // defensible basis/proceeds figure to report.
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
    if (l.section1256) {
      longTerm += l.gain * 0.6;
      shortTerm += l.gain * 0.4;
    } else if (l.term === "long") longTerm += l.gain;
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

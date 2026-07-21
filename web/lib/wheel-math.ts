/**
 * Wheel & premium-collection math — pure functions over investment-trade
 * rows, db-free and tested.
 *
 * Ground truth conventions (verified against real Plaid/import rows):
 *   - type 'sell': cash credited  → amount NEGATIVE, quantity positive
 *   - type 'buy':  cash debited   → amount POSITIVE
 *   - type 'transfer' with quantity ≠ 0 and amount 0: position added/removed
 *     without cash — the broker's expiry / assignment / exercise bookkeeping.
 *
 * Two views come out of this:
 *   - the PREMIUM LEDGER: per short contract (first event is a sell), what
 *     was collected, what was paid to close, and how it ended — open,
 *     bought back, expired worthless, or assigned.
 *   - PREMIUM INCOME: monthly net cash flow across ALL option trades (spread
 *     long legs subtract honestly — this is real options income, not just
 *     the credits).
 */

import { parseOccSymbol, type ParsedOption } from "@/lib/options";

export type TradeRow = {
  date: string; // YYYY-MM-DD
  type: string | null;
  quantity: number | null;
  amount: number | null; // + debit, − credit (dollars)
  ticker: string | null;
};

export type OptionEvent = {
  date: string;
  occ: string;
  parsed: ParsedOption;
  kind: "sell" | "buy" | "remove";
  qty: number; // contracts, always positive
  cash: number; // dollars, + received / − paid (0 for removes)
};

export type StockTrade = {
  date: string;
  ticker: string;
  side: "buy" | "sell";
  qty: number; // shares, positive
  price: number | null;
};

/** Split raw trade rows into option events and stock trades. */
export function mapTrades(rows: TradeRow[]): { events: OptionEvent[]; stocks: StockTrade[] } {
  const events: OptionEvent[] = [];
  const stocks: StockTrade[] = [];
  for (const r of rows) {
    if (!r.ticker || r.quantity == null) continue;
    const qty = Math.abs(r.quantity);
    if (qty === 0) continue;
    const parsed = parseOccSymbol(r.ticker);
    if (parsed) {
      if (r.type === "sell") events.push({ date: r.date, occ: parsed.occ, parsed, kind: "sell", qty, cash: -(r.amount ?? 0) });
      else if (r.type === "buy") events.push({ date: r.date, occ: parsed.occ, parsed, kind: "buy", qty, cash: -(r.amount ?? 0) });
      else if (r.type === "transfer" && (r.amount ?? 0) === 0) {
        events.push({ date: r.date, occ: parsed.occ, parsed, kind: "remove", qty, cash: 0 });
      }
    } else if (r.type === "buy" || r.type === "sell") {
      stocks.push({ date: r.date, ticker: r.ticker.toUpperCase(), side: r.type, qty, price: null });
    }
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  stocks.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { events, stocks };
}

export type CycleOutcome = "open" | "closed" | "expired" | "assigned";

export type ShortCycle = {
  occ: string;
  underlying: string;
  right: "call" | "put";
  strike: number;
  expiry: string;
  opened: string; // first sell date
  closed: string | null; // buy-back / removal / expiry date
  qty: number; // contracts opened
  credit: number; // dollars received opening (and re-opening)
  debit: number; // dollars paid closing (0 when expired/assigned)
  net: number; // credit − debit
  outcome: CycleOutcome;
  daysHeld: number;
  /** For puts: net / (strike·100·qty) annualized — return on collateral. */
  annualizedPct: number | null;
};

const daysBetween = (a: string, b: string) =>
  Math.max(1, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000));

/**
 * Fold events per contract into short-premium cycles. A contract whose FIRST
 * event is a sell is short premium (CSPs, covered calls, short legs of
 * spreads). Buys first = long premium — excluded here, but still counted by
 * monthlyPremium. Assignment: a removal/expiry with a matching stock trade of
 * qty·100 shares in the underlying within ±5 days of expiry (puts → buy,
 * calls → sell).
 */
export function buildShortCycles(events: OptionEvent[], stocks: StockTrade[], today: string): ShortCycle[] {
  const byOcc = new Map<string, OptionEvent[]>();
  for (const e of events) {
    const arr = byOcc.get(e.occ) ?? [];
    arr.push(e);
    byOcc.set(e.occ, arr);
  }

  const cycles: ShortCycle[] = [];
  for (const [occ, evs] of byOcc) {
    if (evs[0]!.kind !== "sell") continue; // long premium — not a wheel leg
    const parsed = evs[0]!.parsed;

    let openQty = 0;
    let credit = 0;
    let debit = 0;
    let removed: OptionEvent | null = null;
    for (const e of evs) {
      if (e.kind === "sell") {
        openQty += e.qty;
        credit += e.cash;
      } else if (e.kind === "buy") {
        openQty -= e.qty;
        debit += -e.cash; // e.cash is negative for buys
      } else if (e.kind === "remove") {
        openQty -= e.qty;
        removed = e;
      }
    }

    const qty = evs.filter((e) => e.kind === "sell").reduce((a, e) => a + e.qty, 0);
    const opened = evs[0]!.date;
    const expired = parsed.expiry < today;

    // Resolution order: an explicit removal (broker bookkeeping at expiry /
    // assignment) wins; else fully bought back = closed; else past expiry
    // with no close recorded = expired/assigned; else still open.
    let outcome: CycleOutcome;
    let closed: string | null;
    if (removed) {
      closed = removed.date;
      outcome = matchAssignment(parsed, qty, stocks) ? "assigned" : "expired";
    } else if (openQty <= 0) {
      closed = [...evs].reverse().find((e) => e.kind === "buy")?.date ?? evs[evs.length - 1]!.date;
      outcome = "closed";
    } else if (expired) {
      closed = parsed.expiry;
      outcome = matchAssignment(parsed, qty, stocks) ? "assigned" : "expired";
    } else {
      closed = null;
      outcome = "open";
    }

    const net = credit - debit;
    const end = closed ?? today;
    const daysHeld = daysBetween(opened, end);
    const collateral = parsed.right === "put" ? parsed.strike * 100 * qty : null;
    cycles.push({
      occ,
      underlying: parsed.underlying,
      right: parsed.right,
      strike: parsed.strike,
      expiry: parsed.expiry,
      opened,
      closed,
      qty,
      credit,
      debit,
      net,
      outcome,
      daysHeld,
      annualizedPct: collateral && collateral > 0 ? (net / collateral / daysHeld) * 365 * 100 : null,
    });
  }
  return cycles.sort((a, b) => (a.opened > b.opened ? -1 : 1));
}

function matchAssignment(parsed: ParsedOption, qty: number, stocks: StockTrade[]): boolean {
  const wantSide = parsed.right === "put" ? "buy" : "sell";
  const wantQty = qty * 100;
  const expiryMs = Date.parse(`${parsed.expiry}T00:00:00Z`);
  return stocks.some(
    (s) =>
      s.ticker === parsed.underlying &&
      s.side === wantSide &&
      Math.abs(s.qty - wantQty) < 0.5 &&
      Math.abs(Date.parse(`${s.date}T00:00:00Z`) - expiryMs) <= 5 * 86_400_000,
  );
}

// ── income reporting ─────────────────────────────────────────────────

export type MonthlyPremium = { month: string; credits: number; debits: number; net: number; trades: number };

/** Net option cash flow per month, over ALL option trades (spreads honest). */
export function monthlyPremium(events: OptionEvent[]): MonthlyPremium[] {
  const byMonth = new Map<string, MonthlyPremium>();
  for (const e of events) {
    if (e.kind === "remove") continue;
    const month = e.date.slice(0, 7);
    const m = byMonth.get(month) ?? { month, credits: 0, debits: 0, net: 0, trades: 0 };
    if (e.cash >= 0) m.credits += e.cash;
    else m.debits += -e.cash;
    m.net += e.cash;
    m.trades += 1;
    byMonth.set(month, m);
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

export function cumulativeNet(months: MonthlyPremium[]): Array<{ month: string; cumulative: number }> {
  let run = 0;
  return months.map((m) => ({ month: m.month, cumulative: (run += m.net) }));
}

export type UnderlyingRollup = {
  underlying: string;
  net: number;
  cycles: number;
  open: number;
  /** % of finished cycles that ended profitably (net > 0). */
  winRatePct: number | null;
};

export function rollupByUnderlying(cycles: ShortCycle[]): UnderlyingRollup[] {
  const by = new Map<string, ShortCycle[]>();
  for (const c of cycles) {
    const arr = by.get(c.underlying) ?? [];
    arr.push(c);
    by.set(c.underlying, arr);
  }
  return [...by.entries()]
    .map(([underlying, list]) => {
      const done = list.filter((c) => c.outcome !== "open");
      const wins = done.filter((c) => c.net > 0).length;
      return {
        underlying,
        net: list.reduce((a, c) => a + c.net, 0),
        cycles: list.length,
        open: list.filter((c) => c.outcome === "open").length,
        winRatePct: done.length > 0 ? (wins / done.length) * 100 : null,
      };
    })
    .sort((a, b) => b.net - a.net);
}

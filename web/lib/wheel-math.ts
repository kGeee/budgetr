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

import { classifyOptionLegs, parseOccSymbol, type ParsedOption } from "@/lib/options";

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


// ── spread exclusion + wheel ledger ──────────────────────────────────

export type WheelLedger = {
  cycles: ShortCycle[]; // wheel-eligible only (naked CSP / CC premium)
  spreadLegsExcluded: number;
  /** Cash events of eligible contracts — feed monthlyPremium for wheel income. */
  incomeEvents: OptionEvent[];
};

/**
 * Cycles minus spread legs. A short contract is a spread leg — not wheel
 * premium — when a LONG-opened contract exists on the same underlying,
 * expiry, and right within ±3 days of its open (verticals, calendars-ish,
 * and same-day multi-leg tickets all match this).
 */
export function buildWheelLedger(events: OptionEvent[], stocks: StockTrade[], today: string): WheelLedger {
  const all = buildShortCycles(events, stocks, today);

  // Long-opened contracts (first event is a buy) indexed by structure key.
  const firstEvent = new Map<string, OptionEvent>();
  for (const e of events) if (!firstEvent.has(e.occ)) firstEvent.set(e.occ, e);
  const longOpens = new Map<string, string[]>();
  for (const e of firstEvent.values()) {
    if (e.kind !== "buy") continue;
    const k = `${e.parsed.underlying}|${e.parsed.expiry}|${e.parsed.right}`;
    const arr = longOpens.get(k) ?? [];
    arr.push(e.date);
    longOpens.set(k, arr);
  }

  const isSpreadLeg = (c: ShortCycle) =>
    (longOpens.get(`${c.underlying}|${c.expiry}|${c.right}`) ?? []).some(
      (d) => Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${c.opened}T00:00:00Z`)) <= 3 * 86_400_000,
    );

  const cycles = all.filter((c) => !isSpreadLeg(c));
  const eligible = new Set(cycles.map((c) => c.occ));
  return {
    cycles,
    spreadLegsExcluded: all.length - cycles.length,
    incomeEvents: events.filter((e) => e.kind !== "remove" && eligible.has(e.occ)),
  };
}

// ── open positions from holdings ─────────────────────────────────────

export type HoldingLike = {
  ticker: string | null;
  /** SHARES-based for options in this schema: ±100 per contract. */
  quantity: number | null;
  value: number | null;
  costBasis: number | null;
};

export type OpenShortPosition = {
  occ: string;
  underlying: string;
  right: "call" | "put";
  strike: number;
  expiry: string;
  contracts: number;
  credit: number | null; // received at open (negative basis on a short)
  markToClose: number | null;
  collateral: number | null; // puts: strike · 100 · contracts
  covered: boolean | null; // calls: shares ≥ 100/contract
};

/**
 * Open wheel positions from live holdings. Two rules learned the hard way:
 *  - holdings store option quantity as SHARES (±100 per contract) — divide,
 *    or every risk figure is exactly 100× reality;
 *  - legs that classify into multi-leg structures (verticals, combos) are
 *    spread risk, not wheel premium — only lone short legs qualify.
 */
export function openShortPositions(holdings: HoldingLike[]): OpenShortPosition[] {
  const sharesByTicker = new Map<string, number>();
  const legs: Array<{ parsed: ParsedOption; h: HoldingLike }> = [];
  for (const h of holdings) {
    if (!h.ticker || h.quantity == null) continue;
    const parsed = parseOccSymbol(h.ticker);
    if (parsed) legs.push({ parsed, h });
    else sharesByTicker.set(h.ticker.toUpperCase(), (sharesByTicker.get(h.ticker.toUpperCase()) ?? 0) + h.quantity);
  }

  // Classify per underlying with quantities AS STORED (the classifier's own
  // convention); keep only single-leg short structures.
  const byUnderlying = new Map<string, Array<{ parsed: ParsedOption; h: HoldingLike }>>();
  for (const leg of legs) {
    const arr = byUnderlying.get(leg.parsed.underlying) ?? [];
    arr.push(leg);
    byUnderlying.set(leg.parsed.underlying, arr);
  }

  const out: OpenShortPosition[] = [];
  for (const [underlying, group] of byUnderlying) {
    const structures = classifyOptionLegs(group.map(({ parsed, h }) => ({ parsed, quantity: h.quantity, costBasis: h.costBasis })));
    for (const st of structures) {
      if (st.kind !== "single") continue; // spreads/combos are not wheel premium
      const { parsed, h } = group[st.legIndexes[0]!]!;
      if ((h.quantity ?? 0) >= 0) continue; // long singles are not premium either
      const contracts = Math.abs(h.quantity!) / 100; // shares-based → contracts
      out.push({
        occ: parsed.occ,
        underlying,
        right: parsed.right,
        strike: parsed.strike,
        expiry: parsed.expiry,
        contracts,
        credit: h.costBasis != null && h.costBasis < 0 ? -h.costBasis : null,
        markToClose: h.value != null ? Math.abs(h.value) : null,
        collateral: parsed.right === "put" ? parsed.strike * 100 * contracts : null,
        covered: parsed.right === "call" ? (sharesByTicker.get(underlying) ?? 0) >= contracts * 100 : null,
      });
    }
  }
  return out;
}

// ── wheel stories: chained CSP → assignment → CC → called away ───────

export type WheelPhase =
  | { kind: "csp"; cycle: ShortCycle }
  | { kind: "assigned"; date: string; shares: number; costPerShare: number }
  | { kind: "cc"; cycle: ShortCycle }
  | { kind: "calledAway"; date: string; shares: number; pricePerShare: number };

export type WheelStory = {
  underlying: string;
  phases: WheelPhase[];
  status: "selling-puts" | "holding-shares" | "selling-calls" | "completed";
  started: string;
  ended: string | null;
  shares: number; // shares held during the story (0 while only selling puts)
  premium: number; // Σ net premium across all phases
  stockPnl: number | null; // (call strike − put strike) · shares, when completed
  total: number; // premium + stockPnl
  /** Assignment strike minus premium per share — what the shares really cost. */
  adjustedBasis: number | null;
};

/**
 * Chain cycles per underlying into full wheel narratives. A story opens with
 * put-selling, turns into share-holding on assignment, collects covered-call
 * premium, and completes when calls are assigned (called away). Lone cycles
 * with no chaining stay in the flat ledger — a story needs at least an
 * assignment or a put→call handoff to say something the ledger doesn't.
 */
export function buildWheelStories(cycles: ShortCycle[]): WheelStory[] {
  const byUnderlying = new Map<string, ShortCycle[]>();
  for (const c of cycles) {
    const arr = byUnderlying.get(c.underlying) ?? [];
    arr.push(c);
    byUnderlying.set(c.underlying, arr);
  }

  const stories: WheelStory[] = [];
  for (const [underlying, list] of byUnderlying) {
    const ordered = [...list].sort((a, b) => (a.opened < b.opened ? -1 : 1));
    let story: WheelStory | null = null;
    let assignStrike: number | null = null;

    const finalize = () => {
      if (!story) return;
      const chained =
        story.phases.some((p) => p.kind === "assigned" || p.kind === "calledAway") ||
        (story.phases.some((p) => p.kind === "csp") && story.phases.some((p) => p.kind === "cc"));
      if (chained) stories.push(story);
      story = null;
      assignStrike = null;
    };

    for (const c of ordered) {
      if (c.right === "put") {
        if (story && story.status !== "selling-puts") finalize(); // new wheel begins
        if (!story) {
          story = {
            underlying,
            phases: [],
            status: "selling-puts",
            started: c.opened,
            ended: null,
            shares: 0,
            premium: 0,
            stockPnl: null,
            total: 0,
            adjustedBasis: null,
          };
        }
        story.phases.push({ kind: "csp", cycle: c });
        story.premium += c.net;
        if (c.outcome === "assigned") {
          const shares = c.qty * 100;
          story.phases.push({ kind: "assigned", date: c.closed ?? c.expiry, shares, costPerShare: c.strike });
          story.shares = shares;
          assignStrike = c.strike;
          story.status = "holding-shares";
        }
      } else {
        // covered call
        if (!story || story.status === "selling-puts") {
          // CC without a tracked assignment: shares were bought outright —
          // still a wheel-ish story once calls chain on.
          finalize();
          story = {
            underlying,
            phases: [],
            status: "selling-calls",
            started: c.opened,
            ended: null,
            shares: c.qty * 100,
            premium: 0,
            stockPnl: null,
            total: 0,
            adjustedBasis: null,
          };
        }
        story.phases.push({ kind: "cc", cycle: c });
        story.premium += c.net;
        story.status = c.outcome === "open" ? "selling-calls" : story.status === "selling-puts" ? story.status : "holding-shares";
        if (c.outcome === "assigned") {
          const shares = c.qty * 100;
          story.phases.push({ kind: "calledAway", date: c.closed ?? c.expiry, shares, pricePerShare: c.strike });
          story.stockPnl = assignStrike != null ? (c.strike - assignStrike) * shares : null;
          story.status = "completed";
          story.ended = c.closed ?? c.expiry;
        }
      }
      if (story) {
        story.total = story.premium + (story.stockPnl ?? 0);
        story.adjustedBasis =
          assignStrike != null && story.shares > 0 ? assignStrike - story.premium / story.shares : null;
      }
      if (story && story.status === "completed") finalize();
    }
    finalize();
  }
  return stories.sort((a, b) => (a.started > b.started ? -1 : 1));
}

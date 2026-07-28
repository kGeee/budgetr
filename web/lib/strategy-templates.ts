/**
 * One-click options strategy templates (OptionStrat-style) — given the live
 * strike grid and spot, each returns the signed legs for a named structure so the
 * builder can drop in a bull-call spread or an iron condor without hand-picking
 * strikes. Pure + single-expiry (calendars/diagonals need multiple expiries and
 * are out of scope here). A template returns null when the chain lacks the
 * strikes it needs (e.g. no room for wings), so the UI can disable it.
 */

export type LegSpec = { right: "call" | "put"; strike: number; contracts: number };

export type TemplateKey =
  | "long-call"
  | "long-put"
  | "bull-call"
  | "bear-put"
  | "bull-put"
  | "bear-call"
  | "straddle"
  | "strangle"
  | "iron-condor"
  | "iron-butterfly"
  | "call-butterfly";

export type Bias = "bullish" | "bearish" | "neutral" | "volatile";

export type StrategyTemplate = {
  key: TemplateKey;
  label: string;
  bias: Bias;
  /** One-line "what it's for". */
  note: string;
};

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  { key: "long-call", label: "Long call", bias: "bullish", note: "Leveraged upside, capped risk" },
  { key: "long-put", label: "Long put", bias: "bearish", note: "Leveraged downside, capped risk" },
  { key: "bull-call", label: "Bull call spread", bias: "bullish", note: "Debit spread, defined risk" },
  { key: "bear-put", label: "Bear put spread", bias: "bearish", note: "Debit spread, defined risk" },
  { key: "bull-put", label: "Bull put spread", bias: "bullish", note: "Credit spread, collect premium" },
  { key: "bear-call", label: "Bear call spread", bias: "bearish", note: "Credit spread, collect premium" },
  { key: "straddle", label: "Long straddle", bias: "volatile", note: "Profits from a big move either way" },
  { key: "strangle", label: "Long strangle", bias: "volatile", note: "Cheaper straddle, wider breakevens" },
  { key: "iron-condor", label: "Iron condor", bias: "neutral", note: "Range-bound, defined-risk credit" },
  { key: "iron-butterfly", label: "Iron butterfly", bias: "neutral", note: "Tight range, bigger credit" },
  { key: "call-butterfly", label: "Call butterfly", bias: "neutral", note: "Pins near the middle strike" },
];

/** Index of the strike closest to spot. */
function atmIndex(strikes: number[], spot: number): number {
  let best = 0;
  for (let i = 1; i < strikes.length; i++) {
    if (Math.abs(strikes[i] - spot) < Math.abs(strikes[best] - spot)) best = i;
  }
  return best;
}

/**
 * Build the legs for a template against the sorted `strikes` grid. Returns null
 * if a required strike offset falls outside the grid, or a structure would
 * collapse (a wing landing on the body).
 */
export function buildTemplate(key: TemplateKey, strikes: number[], spot: number): LegSpec[] | null {
  if (strikes.length < 1) return null;
  const sorted = [...strikes].sort((a, b) => a - b);
  const atm = atmIndex(sorted, spot);
  // Guarded accessor: returns null (via the caller's checks) when out of range.
  const S = (offset: number): number | null => {
    const i = atm + offset;
    return i >= 0 && i < sorted.length ? sorted[i] : null;
  };

  const legs = (specs: ([right: "call" | "put", off: number, qty: number])[]): LegSpec[] | null => {
    const out: LegSpec[] = [];
    for (const [right, off, qty] of specs) {
      const strike = S(off);
      if (strike == null) return null;
      out.push({ right, strike, contracts: qty });
    }
    // Reject structures where two legs collapsed onto the same strike+right.
    const seen = new Set<string>();
    for (const l of out) {
      const id = `${l.right}:${l.strike}`;
      if (seen.has(id)) return null;
      seen.add(id);
    }
    return out;
  };

  switch (key) {
    case "long-call":
      return legs([["call", 0, 1]]);
    case "long-put":
      return legs([["put", 0, 1]]);
    case "bull-call":
      return legs([["call", 0, 1], ["call", 2, -1]]);
    case "bear-put":
      return legs([["put", 0, 1], ["put", -2, -1]]);
    case "bull-put":
      return legs([["put", 0, -1], ["put", -2, 1]]);
    case "bear-call":
      return legs([["call", 0, -1], ["call", 2, 1]]);
    case "straddle":
      return legs([["call", 0, 1], ["put", 0, 1]]);
    case "strangle":
      return legs([["call", 1, 1], ["put", -1, 1]]);
    case "iron-condor":
      return legs([["put", -1, -1], ["put", -3, 1], ["call", 1, -1], ["call", 3, 1]]);
    case "iron-butterfly":
      return legs([["call", 0, -1], ["put", 0, -1], ["call", 2, 1], ["put", -2, 1]]);
    case "call-butterfly":
      return legs([["call", -1, 1], ["call", 1, -2], ["call", 3, 1]]);
    default:
      return null;
  }
}

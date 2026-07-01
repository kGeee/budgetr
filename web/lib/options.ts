/**
 * Option (OCC symbol) parsing + light structure recognition.
 *
 * Brokerages report option positions with their OCC symbol as the ticker, e.g.
 * `LRCX260821C00430000` → LRCX, 2026-08-21, Call, $430 strike. These pollute the
 * holdings table as opaque rows, so the investments view folds every contract on
 * the same underlying into one collapsible group and labels common multi-leg
 * structures (vertical spreads) instead of listing raw legs.
 *
 * Pure module (no DB / server deps) so it's usable from client components too.
 */

export type ParsedOption = {
  occ: string; // normalized OCC symbol
  underlying: string; // e.g. "LRCX"
  expiry: string; // YYYY-MM-DD
  right: "call" | "put";
  strike: number; // dollars
};

// OCC: root (alpha) + YYMMDD + C/P + strike (8 digits, price × 1000).
const OCC_RE = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;

/** Parse an OCC option symbol, or null if it isn't one (equities/ETFs/etc.). */
export function parseOccSymbol(symbol?: string | null): ParsedOption | null {
  if (!symbol) return null;
  const s = symbol.trim().toUpperCase();
  const m = s.match(OCC_RE);
  if (!m) return null;
  const [, underlying, yy, mm, dd, cp, strike] = m;
  return {
    occ: s,
    underlying,
    expiry: `20${yy}-${mm}-${dd}`,
    right: cp === "C" ? "call" : "put",
    strike: parseInt(strike, 10) / 1000,
  };
}

/** "$430" or "$7.50" — drops the cents when the strike is whole. */
export function formatStrike(n: number): string {
  return n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

/** "Aug 21 '26" — compact expiry label from a YYYY-MM-DD string. */
export function formatOptionExpiry(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!y || !m || !d) return iso;
  return `${months[m - 1]} ${d} '${String(y).slice(2)}`;
}

export type OptionLegInput = {
  parsed: ParsedOption;
  quantity: number | null;
  /** Total cost basis for the leg (debit paid > 0, credit received < 0). */
  costBasis?: number | null;
};

export type OptionStructure = {
  kind: "vertical" | "single" | "combo";
  /** Headline label, e.g. "Bull call spread", "Long put". */
  label: string;
  /** Secondary descriptor, e.g. "$430 / $450 · Aug 21 '26". */
  detail: string;
  /** Indexes into the input `legs` array that make up this structure. */
  legIndexes: number[];
  /** Best-case P&L in dollars at expiry (null when unbounded or un-costed). */
  maxProfit?: number | null;
  /** Worst-case P&L in dollars at expiry, as a positive magnitude. */
  maxLoss?: number | null;
  /** Underlying price at which the structure breaks even at expiry. */
  breakeven?: number | null;
};

// ── Expiry / risk helpers ──────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Whole calendar days from today to `expiry` (YYYY-MM-DD). Compared at UTC
 * midnight so the count is stable regardless of the caller's clock time.
 * Negative once the contract has expired, 0 on expiry day.
 */
export function daysToExpiry(expiry: string, now: Date = new Date()): number {
  const [y, m, d] = expiry.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const exp = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((exp - today) / MS_PER_DAY);
}

/** Coarse expiry-risk severity, driving badge colour + sort order. */
export type RiskLevel = "expired" | "high" | "medium" | "ok";

/** expired | <7d (high) | <30d (medium) | ok, from a days-to-expiry count. */
export function riskLevel(dte: number): RiskLevel {
  if (dte < 0) return "expired";
  if (dte <= 7) return "high";
  if (dte <= 30) return "medium";
  return "ok";
}

/** Short human label for the DTE bucket, e.g. "Expired", "5d", "23d", "≥30d". */
export function expiryBucket(dte: number): string {
  if (dte < 0) return "Expired";
  if (dte === 0) return "Today";
  if (dte <= 30) return `${dte}d`;
  return "≥30d";
}

/** In-the-money tests — a call is ITM above its strike, a put below it. */
export function isItmCall(strike: number, underlyingPrice: number): boolean {
  return underlyingPrice > strike;
}
export function isItmPut(strike: number, underlyingPrice: number): boolean {
  return underlyingPrice < strike;
}

/**
 * Position-level expiry risk flag for a single leg:
 *  - a SHORT leg that is ITM near expiry risks assignment;
 *  - a LONG leg that is OTM near expiry risks expiring worthless.
 * Returns null when neither applies, the contract is far from expiry, or we
 * lack an underlying price to judge moneyness.
 */
export type OptionRiskFlag = "assignment" | "expiry" | null;

export function optionRiskFlag(
  p: ParsedOption,
  quantity: number | null,
  underlyingPrice: number | null | undefined,
  dte: number,
): OptionRiskFlag {
  if (underlyingPrice == null || dte < 0 || dte > 30) return null;
  const itm = p.right === "call" ? isItmCall(p.strike, underlyingPrice) : isItmPut(p.strike, underlyingPrice);
  const qty = quantity ?? 0;
  if (qty < 0 && itm) return "assignment";
  // Long, out-of-the-money, and inside the final week → likely to expire worthless.
  if (qty > 0 && !itm && dte <= 7) return "expiry";
  return null;
}

/**
 * Group legs sharing an expiry+right and recognize common structures:
 *  - two opposite-sign legs → a vertical spread (bull/bear call/put)
 *  - one leg → a long/short single
 *  - anything else → a generic N-leg combo
 *
 * Legs across different expiries or rights stay as separate structures (we don't
 * attempt to name calendars / iron condors — they render as their parts).
 */
export function classifyOptionLegs(legs: OptionLegInput[]): OptionStructure[] {
  const groups = new Map<string, number[]>();
  legs.forEach((l, i) => {
    const key = `${l.parsed.expiry}|${l.parsed.right}`;
    const arr = groups.get(key);
    if (arr) arr.push(i);
    else groups.set(key, [i]);
  });

  const out: OptionStructure[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length === 2) {
      const a = legs[idxs[0]];
      const b = legs[idxs[1]];
      const qa = a.quantity ?? 0;
      const qb = b.quantity ?? 0;
      if (qa !== 0 && qb !== 0 && Math.sign(qa) !== Math.sign(qb)) {
        const right = a.parsed.right;
        const longLeg = qa > 0 ? a : b;
        const shortLeg = qa > 0 ? b : a;
        const lower = Math.min(a.parsed.strike, b.parsed.strike);
        const upper = Math.max(a.parsed.strike, b.parsed.strike);
        const bias =
          right === "call"
            ? longLeg.parsed.strike < shortLeg.parsed.strike
              ? "Bull"
              : "Bear"
            : longLeg.parsed.strike > shortLeg.parsed.strike
              ? "Bear"
              : "Bull";
        out.push({
          kind: "vertical",
          label: `${bias} ${right} spread`,
          detail: `${formatStrike(lower)} / ${formatStrike(upper)} · ${formatOptionExpiry(a.parsed.expiry)}`,
          legIndexes: idxs,
          ...verticalEconomics(a, b, lower, upper, right),
        });
        continue;
      }
    }

    if (idxs.length === 1) {
      const l = legs[idxs[0]];
      const dir = (l.quantity ?? 0) >= 0 ? "Long" : "Short";
      out.push({
        kind: "single",
        label: `${dir} ${l.parsed.right}`,
        detail: `${formatStrike(l.parsed.strike)} · ${formatOptionExpiry(l.parsed.expiry)}`,
        legIndexes: idxs,
        ...singleEconomics(l),
      });
    } else {
      const l0 = legs[idxs[0]];
      out.push({
        kind: "combo",
        label: `${idxs.length}-leg ${l0.parsed.right}`,
        detail: formatOptionExpiry(l0.parsed.expiry),
        legIndexes: idxs,
      });
    }
  }
  return out;
}

/** Contracts × 100 — the share multiplier one option leg controls. */
const CONTRACT_SIZE = 100;

type Economics = { maxProfit: number | null; maxLoss: number | null; breakeven: number | null };

/**
 * Max-profit / max-loss / breakeven for a two-leg vertical, derived purely from
 * the legs' cost basis. Net debit (> 0) = a debit spread capped at the strike
 * width; net credit (< 0) = a credit spread keeping the premium. Returns nulls
 * when either leg lacks a cost basis (nothing to net against).
 */
function verticalEconomics(
  a: OptionLegInput,
  b: OptionLegInput,
  lower: number,
  upper: number,
  right: "call" | "put",
): Economics {
  if (a.costBasis == null || b.costBasis == null) {
    return { maxProfit: null, maxLoss: null, breakeven: null };
  }
  const contracts = Math.min(Math.abs(a.quantity ?? 0), Math.abs(b.quantity ?? 0)) || 1;
  const widthValue = (upper - lower) * CONTRACT_SIZE * contracts;
  const netDebit = a.costBasis + b.costBasis; // >0 paid, <0 received
  const perShare = Math.abs(netDebit) / (CONTRACT_SIZE * contracts);
  // Call verticals break even above the lower strike; puts below the upper one.
  const breakeven = right === "call" ? lower + perShare : upper - perShare;
  if (netDebit >= 0) {
    return { maxLoss: netDebit, maxProfit: widthValue - netDebit, breakeven };
  }
  const credit = -netDebit;
  return { maxProfit: credit, maxLoss: widthValue - credit, breakeven };
}

/**
 * Economics for a lone leg. A long option can only lose its premium; its upside
 * is unbounded (call) or capped at the strike going to zero (put). Short singles
 * carry undefined/undefinable risk here, so we leave everything null.
 */
function singleEconomics(l: OptionLegInput): Economics {
  const qty = l.quantity ?? 0;
  if (qty <= 0 || l.costBasis == null) {
    return { maxProfit: null, maxLoss: null, breakeven: null };
  }
  const contracts = Math.abs(qty) || 1;
  const perShare = l.costBasis / (CONTRACT_SIZE * contracts);
  if (l.parsed.right === "call") {
    return { maxProfit: null, maxLoss: l.costBasis, breakeven: l.parsed.strike + perShare };
  }
  const maxProfit = l.parsed.strike * CONTRACT_SIZE * contracts - l.costBasis;
  return { maxProfit, maxLoss: l.costBasis, breakeven: l.parsed.strike - perShare };
}

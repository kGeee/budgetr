/**
 * The sentences under the Investments and Trading-desk heroes.
 *
 * Each page used to open with a row of equal-weight tiles and leave the reader
 * to work out which one mattered. These turn numbers that were already on the
 * page into the one line read first. Same shape as lib/budget-verdict.ts: pure,
 * no clock, no formatting of money — an `amount` is formatted at the call site
 * with formatCurrency so privacy mode and the display currency are honoured.
 * Percentages and counts are not masked anywhere in the app, so those are
 * returned ready to print.
 */

export type VerdictTone = "default" | "jade" | "brass" | "coral";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ── Allocation ───────────────────────────────────────────────────────────────

export type AllocationVerdict = {
  tone: VerdictTone;
  /** Words before the share. */
  lead: string;
  /** The share the sentence turns on, e.g. "38%". */
  share: string;
  /** Words after the share, including the full stop. */
  tail: string;
};

/**
 * Which slice of the book is biggest, and how much of it that is.
 *
 * @param slices      sector slices as drawn on the page (any order)
 * @param unassigned  the label the page uses for holdings with no sector
 */
export function allocationVerdict({
  slices,
  total,
  unassigned,
}: {
  slices: { sector: string; value: number }[];
  total: number;
  unassigned: string;
}): AllocationVerdict | null {
  if (!(total > 0)) return null;
  const ranked = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const top = ranked[0];
  if (!top) return null;

  const share = `${Math.round((top.value / total) * 100)}%`;

  // Untagged money leading the chart is a filing problem, not an allocation.
  if (top.sector === unassigned) {
    return {
      tone: "brass",
      lead: "The largest slice,",
      share,
      tail: "of the book, has no sector assigned yet.",
    };
  }

  const named = ranked.filter((s) => s.sector !== unassigned).length;
  if (ranked.length === 1) {
    return { tone: "brass", lead: `${top.sector} is`, share, tail: "of the book — the only sector in it." };
  }
  return {
    tone: top.value / total >= 0.5 ? "brass" : "default",
    lead: `${top.sector} is the largest sector at`,
    share,
    tail: `of the book, across ${plural(named, "sector")}.`,
  };
}

// ── Realized gains ───────────────────────────────────────────────────────────

export type AmountVerdict = {
  tone: VerdictTone;
  lead: string;
  /** Always positive — the direction is in the words. `null` when there is no figure. */
  amount: number | null;
  tail: string;
};

/** Net result of the closed lots on screen. */
export function realizedVerdict({ total, count }: { total: number; count: number }): AmountVerdict | null {
  if (count <= 0) return null;
  const lots = `across ${plural(count, "closed lot")}.`;
  if (Math.abs(total) < 0.005) {
    return { tone: "default", lead: "Sales broke even", amount: null, tail: lots };
  }
  return total > 0
    ? { tone: "jade", lead: "Sales realized a net gain of", amount: total, tail: lots }
    : { tone: "coral", lead: "Sales realized a net loss of", amount: -total, tail: lots };
}

// ── Options › Positions ──────────────────────────────────────────────────────

export type OptionsBookVerdict = {
  tone: VerdictTone;
  /** What the next week holds, as a whole sentence. */
  expiry: string;
  /** Cash the short puts would call for at strike; `null` when there are none. */
  assigned: number | null;
};

/**
 * @param soon      legs expiring within seven days
 * @param soonItm   of those, how many are in the money
 * @param ifAssigned  strike × 100 × contracts over the open short puts
 */
export function optionsBookVerdict({
  soon,
  soonItm,
  ifAssigned,
}: {
  soon: number;
  soonItm: number;
  ifAssigned: number;
}): OptionsBookVerdict {
  const assigned = ifAssigned > 0.005 ? ifAssigned : null;
  if (soon <= 0) {
    return { tone: "jade", expiry: "Nothing expires in the next seven days.", assigned };
  }
  const legs = `${plural(soon, "leg")} ${soon === 1 ? "expires" : "expire"} within seven days`;
  if (soonItm <= 0) {
    return { tone: "brass", expiry: `${legs}, none in the money.`, assigned };
  }
  return {
    tone: "coral",
    expiry: `${legs} — ${soonItm === soon ? (soon === 1 ? "and it is" : "all of them") : soonItm} in the money.`,
    assigned,
  };
}

// ── Options › Wheel ──────────────────────────────────────────────────────────

/** This month's contribution to the premium total, and what is still open. */
export function wheelVerdict({
  netThisMonth,
  openContracts,
  uncoveredCalls,
}: {
  netThisMonth: number;
  openContracts: number;
  uncoveredCalls: number;
}): AmountVerdict {
  const open =
    openContracts > 0
      ? `with ${plural(openContracts, "short contract")} still open`
      : "with no short contracts open";
  const uncovered =
    uncoveredCalls > 0 ? ` — ${plural(uncoveredCalls, "call")} of them uncovered` : "";
  const tail = `${open}${uncovered}.`;

  if (Math.abs(netThisMonth) < 0.005) {
    return {
      tone: uncoveredCalls > 0 ? "coral" : "default",
      lead: "No premium booked this month,",
      amount: null,
      tail,
    };
  }
  return {
    tone: uncoveredCalls > 0 || netThisMonth < 0 ? "coral" : "jade",
    lead: netThisMonth > 0 ? "This month added" : "This month gave back",
    amount: Math.abs(netThisMonth),
    tail,
  };
}

// ── Options › Scanner ────────────────────────────────────────────────────────

export type ScanVerdict = {
  tone: VerdictTone;
  lead: string;
  /** The contract the sentence names, e.g. "MU 95p"; `null` when nothing ranked. */
  pick: string | null;
  tail: string;
};

/**
 * @param best  the top-ranked candidate, with its strike already formatted
 */
export function scanVerdict({
  universe,
  best,
}: {
  universe: number;
  best: { ticker: string; strike: string; annualizedPct: number; score: number } | null | undefined;
}): ScanVerdict {
  if (!best) {
    return {
      tone: "default",
      lead: `None of the ${plural(universe, "symbol")} scanned has a put inside the window.`,
      pick: null,
      tail: "",
    };
  }
  return {
    tone: "jade",
    lead: "The best-ranked put is",
    pick: `${best.ticker} ${best.strike}p`,
    tail: `at ${best.annualizedPct.toFixed(0)}% annualized, scoring ${best.score}.`,
  };
}

// ── Fundamentals ─────────────────────────────────────────────────────────────

export type MarginVerdict = {
  tone: VerdictTone;
  lead: string;
  /** Net margin as printed, e.g. "25.3%" — unsigned; the direction is in the words. */
  margin: string;
  tail: string;
};

/** What a company kept of each dollar it sold. */
export function marginVerdict({
  revenue,
  netIncome,
}: {
  revenue: number;
  netIncome: number;
}): MarginVerdict | null {
  if (!revenue) return null;
  const pct = (netIncome / revenue) * 100;
  const margin = `${Math.abs(pct).toFixed(1)}%`;
  return pct >= 0
    ? { tone: "jade", lead: "kept", margin, tail: "of revenue as net income." }
    : { tone: "coral", lead: "lost", margin, tail: "of revenue after all costs." };
}

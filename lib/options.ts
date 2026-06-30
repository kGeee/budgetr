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

export type OptionLegInput = { parsed: ParsedOption; quantity: number | null };

export type OptionStructure = {
  kind: "vertical" | "single" | "combo";
  /** Headline label, e.g. "Bull call spread", "Long put". */
  label: string;
  /** Secondary descriptor, e.g. "$430 / $450 · Aug 21 '26". */
  detail: string;
  /** Indexes into the input `legs` array that make up this structure. */
  legIndexes: number[];
};

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

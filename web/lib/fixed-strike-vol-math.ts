/**
 * Fixed-strike vol matrix math — pure functions over snapshot rows, kept
 * db-free so they test (and reason) in isolation. The persistence half lives
 * in fixed-strike-vol.ts.
 */

export type IvSnapshotRow = {
  date: string;
  expiry: string;
  strike: number;
  right: "call" | "put";
  iv: number;
  underlying: number | null;
};



export type RightMode = "call" | "put" | "otm";

export type FixedStrikeMatrix = {
  expiry: string;
  dates: string[]; // ascending capture days
  strikes: number[]; // descending (table renders high → low)
  /** `${strike}|${date}` → iv (decimal). */
  cells: Map<string, number>;
  /** capture day → spot that day (null when unknown). */
  spotByDate: Map<string, number | null>;
};

const key = (strike: number, date: string) => `${strike}|${date}`;

/**
 * Build the strikes × dates grid for one expiry. `otm` picks, per strike and
 * day, the out-of-the-money side relative to THAT day's spot — the liquid
 * side of the book, and the convention fixed-strike sheets usually use.
 */
export function buildFixedStrikeMatrix(rows: IvSnapshotRow[], expiry: string, mode: RightMode): FixedStrikeMatrix {
  const inExpiry = rows.filter((r) => r.expiry === expiry);
  const dates = [...new Set(inExpiry.map((r) => r.date))].sort();
  const strikes = [...new Set(inExpiry.map((r) => r.strike))].sort((a, b) => b - a);

  const spotByDate = new Map<string, number | null>();
  for (const d of dates) {
    const withSpot = inExpiry.find((r) => r.date === d && r.underlying != null);
    spotByDate.set(d, withSpot?.underlying ?? null);
  }

  const cells = new Map<string, number>();
  for (const r of inExpiry) {
    const spot = spotByDate.get(r.date) ?? null;
    const want: "call" | "put" =
      mode === "otm" ? (spot != null && r.strike < spot ? "put" : "call") : mode;
    if (r.right !== want) continue;
    cells.set(key(r.strike, r.date), r.iv);
  }
  return { expiry, dates, strikes, cells, spotByDate };
}

export function ivAt(m: FixedStrikeMatrix, strike: number, date: string): number | null {
  return m.cells.get(key(strike, date)) ?? null;
}

/** Day-over-day change at a fixed strike, in vol POINTS (+1.4 = +1.4 vols). */
export function changeAt(m: FixedStrikeMatrix, strike: number, date: string): number | null {
  const i = m.dates.indexOf(date);
  if (i <= 0) return null;
  const now = ivAt(m, strike, date);
  const prev = ivAt(m, strike, m.dates[i - 1]!);
  if (now == null || prev == null) return null;
  return (now - prev) * 100;
}

/** The n strikes bracketing spot on the latest day — the view's default focus. */
export function defaultStrikes(m: FixedStrikeMatrix, n = 5): number[] {
  const lastDate = m.dates[m.dates.length - 1];
  const spot = lastDate ? m.spotByDate.get(lastDate) : null;
  if (spot == null || m.strikes.length === 0) return m.strikes.slice(0, n);
  return [...m.strikes]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, n)
    .sort((a, b) => b - a);
}

/** Time series for one fixed strike: [{date, iv%}], gaps skipped. */
export function strikeSeries(m: FixedStrikeMatrix, strike: number): Array<{ date: string; iv: number }> {
  return m.dates.flatMap((d) => {
    const iv = ivAt(m, strike, d);
    return iv == null ? [] : [{ date: d, iv: iv * 100 }];
  });
}

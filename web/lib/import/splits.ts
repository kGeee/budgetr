/**
 * Corporate-action (stock split) normalization — pure, no DB.
 *
 * The realized-gains engine (lib/tax-lots.ts) has zero corporate-action
 * awareness: it matches raw share counts. So a pre-split 2019 buy of 10 AAPL and
 * a post-split 2024 sell of 40 AAPL never reconcile — 30 shares stay open and the
 * sell is silently dropped, corrupting basis with no error.
 *
 * We fix this WITHOUT mutating stored rows: splits live in their own table and are
 * applied here, at read time, before trades reach the engine. That keeps the raw
 * import faithful to the broker file and lets a split be corrected/added later
 * without re-importing.
 *
 * A split of `numerator:denominator` (a 4-for-1 → numerator 4, denominator 1)
 * effective on `date` restates every trade STRICTLY BEFORE that date into
 * post-split terms: quantity ×= factor, price ÷= factor. Total cash (`amount`) is
 * split-invariant and left untouched — 10 sh × $200 and 40 sh × $50 are both
 * $2,000 of basis.
 */

/** A single corporate action. Ratio is shares-after : shares-before. */
export type StockSplit = {
  ticker: string;
  date: string; // YYYY-MM-DD; post-split terms apply to trades on/after this date
  numerator: number; // shares after  (4:1 → 4)
  denominator: number; // shares before (4:1 → 1)
};

/** The minimal slice of a trade a split rewrites. */
export type SplitAdjustable = {
  date: string;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
};

/**
 * Return copies of `txns` with pre-split quantities/prices restated into
 * present (post-split) terms. Splits for a ticker compound, so a trade before two
 * 2:1 splits is scaled ×4. Non-equity (OCC option) tickers never match a plain
 * equity-symbol split, so options pass through untouched. Amount is preserved.
 */
export function applySplits<T extends SplitAdjustable>(txns: T[], splits: StockSplit[]): T[] {
  if (!splits.length) return txns;

  // Index valid splits by uppercased ticker, ascending by effective date.
  const byTicker = new Map<string, StockSplit[]>();
  for (const s of splits) {
    if (!s.ticker || !(s.numerator > 0) || !(s.denominator > 0)) continue;
    const key = s.ticker.toUpperCase();
    const list = byTicker.get(key) ?? byTicker.set(key, []).get(key)!;
    list.push(s);
  }
  if (!byTicker.size) return txns;
  for (const list of byTicker.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  return txns.map((t) => {
    if (!t.ticker) return t;
    const list = byTicker.get(t.ticker.toUpperCase());
    if (!list) return t;

    // Compound every split effective strictly after this trade.
    let factor = 1;
    for (const s of list) {
      if (t.date < s.date) factor *= s.numerator / s.denominator;
    }
    if (factor === 1) return t;

    return {
      ...t,
      quantity: t.quantity == null ? t.quantity : t.quantity * factor,
      price: t.price == null ? t.price : t.price / factor,
    };
  });
}

/**
 * Option contract primitives shared by the quant modules.
 *
 * The parsed shape and the expiry-day count live here rather than in the web
 * app's option helpers, so this package stays self-contained — it is consumed by
 * the native app too, where `@/lib/*` does not exist. OCC symbol *parsing* stays
 * on the web side for now; core only needs to consume the parsed result.
 */

export type ParsedOption = {
  /** Normalized OCC symbol. */
  occ: string;
  /** Underlying ticker, e.g. "LRCX". */
  underlying: string;
  /** Expiry as YYYY-MM-DD. */
  expiry: string;
  right: "call" | "put";
  /** Strike in dollars. */
  strike: number;
};

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

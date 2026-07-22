/**
 * Fixed-strike volatility — IV tracked at the SAME strike across days, the
 * lens that separates true surface repricing from spot drifting along the
 * skew (sticky-strike vs sticky-delta). Two halves:
 *
 *  - capture: persist today's chain IVs into option_iv_snapshots (idempotent
 *    per day; strikes banded around spot so SPY-sized chains stay sane;
 *    missing IVs back-solved from mid via Black-Scholes and flagged).
 *  - pure matrix math: turn snapshot rows into a strikes × dates grid with
 *    day-over-day changes, plus helpers the view needs. Pure + tested.
 */

import { db } from "@/db";
import { optionIvSnapshots } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import type { OptionChain } from "@/lib/yahoo";
import { daysToExpiry } from "@/lib/options";
import { impliedVol } from "@/lib/black-scholes";
import type { IvSnapshotRow } from "@/lib/fixed-strike-vol-math";

export * from "@/lib/fixed-strike-vol-math";

/** Strikes captured per contract: within [LO, HI] × spot. */
const BAND_LO = 0.5;
const BAND_HI = 1.6;
/** Days of history the view loads. */
export const HISTORY_DAYS = 30;

// ── capture ──────────────────────────────────────────────────────────

/**
 * Persist one day's IV surface for a ticker. Safe to call on every chain
 * fetch: the (ticker, date, expiry, strike, right) unique key makes repeats
 * update in place. Returns the number of contracts written.
 */
export function captureIvSnapshots(
  ticker: string,
  chain: OptionChain,
  spot: number | null,
  band?: { lo?: number; hi?: number },
): number {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const lo = band?.lo ?? BAND_LO;
  const hi = band?.hi ?? BAND_HI;
  let written = 0;

  const rows = chain.contracts.flatMap((c) => {
    if (spot != null && (c.strike < spot * lo || c.strike > spot * hi)) return [];
    const dte = daysToExpiry(c.expiry, now);
    if (dte < 0) return [];

    let iv = c.iv;
    let ivSolved = false;
    if ((iv == null || iv <= 0) && spot != null && c.bid != null && c.ask != null && c.ask > 0) {
      const mid = (c.bid + c.ask) / 2;
      iv = impliedVol(c.right, mid, spot, c.strike, Math.max(dte, 0.5) / 365);
      ivSolved = iv != null;
    }
    if (iv == null || iv <= 0 || iv > 5) return [];

    return [
      {
        ticker,
        date: today,
        expiry: c.expiry,
        strike: c.strike,
        right: c.right,
        iv,
        ivSolved,
        underlying: spot,
        capturedAt: now,
      },
    ];
  });

  // Chunked upserts keep the statement size bounded on big chains.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    db.insert(optionIvSnapshots)
      .values(chunk)
      .onConflictDoUpdate({
        target: [
          optionIvSnapshots.ticker,
          optionIvSnapshots.date,
          optionIvSnapshots.expiry,
          optionIvSnapshots.strike,
          optionIvSnapshots.right,
        ],
        set: {
          iv: sql`excluded.iv`,
          ivSolved: sql`excluded.iv_solved`,
          underlying: sql`excluded.underlying`,
          capturedAt: sql`excluded.captured_at`,
        },
      })
      .run();
    written += chunk.length;
  }
  return written;
}

/** Load the last `days` of snapshots for a ticker (all expiries). */
export function loadIvSnapshots(ticker: string, days = HISTORY_DAYS): IvSnapshotRow[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return db
    .select({
      date: optionIvSnapshots.date,
      expiry: optionIvSnapshots.expiry,
      strike: optionIvSnapshots.strike,
      right: optionIvSnapshots.right,
      iv: optionIvSnapshots.iv,
      underlying: optionIvSnapshots.underlying,
    })
    .from(optionIvSnapshots)
    .where(and(eq(optionIvSnapshots.ticker, ticker), gte(optionIvSnapshots.date, cutoff)))
    .all() as IvSnapshotRow[];
}

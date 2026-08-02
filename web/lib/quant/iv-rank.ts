/**
 * IV rank & percentile from the option_iv_snapshots tape.
 *
 * IV rank is where the current implied vol sits between its own 1-year low and
 * high; IV percentile is the share of days it traded below where it is now. For
 * selling premium (the wheel), high IV rank means richer credit for the same
 * risk — the single most useful "is now a good time?" signal a chain snapshot
 * can't give you on its own.
 *
 * The snapshot tape only accrues for tickers whose option pages have been
 * fetched, so history is sparse until a ticker has been scanned a while; every
 * function returns null rather than a misleading number when there isn't enough
 * history. Pure math (`dailyAtmIv`, `ivRankFromSeries`) is split from the DB
 * read (`getIvRank`) so it can be unit-tested.
 */

import { daysToExpiry } from "@/lib/options";
import { loadIvSnapshots } from "@/lib/fixed-strike-vol";
import type { IvSnapshotRow } from "@/lib/fixed-strike-vol-math";

/** A single day's at-the-money implied vol (decimal, e.g. 0.42). */
export type IvSeriesPoint = { date: string; iv: number };

export type IvRank = {
  /** Latest ATM IV (decimal). */
  current: number;
  /** 0–100: where current sits between the window low (0) and high (100). */
  ivRank: number;
  /** 0–100: share of days that traded at or below current. */
  ivPercentile: number;
  low: number;
  high: number;
  /** Number of distinct days in the window. */
  days: number;
};

/** Minimum distinct days before a rank is meaningful rather than noise. */
const MIN_DAYS = 10;
/** Prefer contracts roughly a month out — the wheel's home turf. */
const TARGET_DTE = 30;
const DTE_LO = 10;
const DTE_HI = 75;

/**
 * Collapse raw snapshot rows into one ATM ~30-DTE implied-vol reading per day.
 * For each date we pick the expiry whose days-to-expiry is closest to ~30 (within
 * [10, 75]), then the strike nearest the underlying, averaging the call/put IV
 * there. Pure — `now` is derived per row from its own capture date.
 */
export function dailyAtmIv(rows: IvSnapshotRow[]): IvSeriesPoint[] {
  const byDate = new Map<string, IvSnapshotRow[]>();
  for (const r of rows) {
    if (!(r.iv > 0)) continue;
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }

  const out: IvSeriesPoint[] = [];
  for (const [date, dayRows] of byDate) {
    const asOf = new Date(`${date}T00:00:00Z`);
    // Choose the expiry nearest the 30-DTE target within the sane band.
    let bestExpiry: string | null = null;
    let bestDist = Infinity;
    const expirySeen = new Set<string>();
    for (const r of dayRows) {
      if (expirySeen.has(r.expiry)) continue;
      expirySeen.add(r.expiry);
      const dte = daysToExpiry(r.expiry, asOf);
      if (dte < DTE_LO || dte > DTE_HI) continue;
      const dist = Math.abs(dte - TARGET_DTE);
      if (dist < bestDist) {
        bestDist = dist;
        bestExpiry = r.expiry;
      }
    }
    if (!bestExpiry) continue;

    const expiryRows = dayRows.filter((r) => r.expiry === bestExpiry);
    // ATM = strike nearest the underlying (fallback: median strike).
    const spot =
      expiryRows.find((r) => r.underlying != null)?.underlying ??
      medianStrike(expiryRows);
    let atmStrike: number | null = null;
    let atmDist = Infinity;
    for (const r of expiryRows) {
      const dist = Math.abs(r.strike - spot);
      if (dist < atmDist) {
        atmDist = dist;
        atmStrike = r.strike;
      }
    }
    if (atmStrike == null) continue;

    const atRows = expiryRows.filter((r) => r.strike === atmStrike);
    const iv = atRows.reduce((a, r) => a + r.iv, 0) / atRows.length;
    if (iv > 0) out.push({ date, iv });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function medianStrike(rows: IvSnapshotRow[]): number {
  const s = rows.map((r) => r.strike).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Rank/percentile of the latest point against the whole series. Returns null
 * when there are too few days, or the range is degenerate (all IVs equal).
 */
export function ivRankFromSeries(series: IvSeriesPoint[]): IvRank | null {
  if (series.length < MIN_DAYS) return null;
  const ivs = series.map((p) => p.iv);
  const current = ivs[ivs.length - 1];
  const low = Math.min(...ivs);
  const high = Math.max(...ivs);
  if (!(high > low)) return null;

  const ivRank = ((current - low) / (high - low)) * 100;
  const atOrBelow = ivs.filter((v) => v <= current).length;
  const ivPercentile = (atOrBelow / ivs.length) * 100;

  return {
    current,
    ivRank: clampPct(ivRank),
    ivPercentile: clampPct(ivPercentile),
    low,
    high,
    days: series.length,
  };
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** DB-backed IV rank for a ticker over the last `days` of snapshots. */
export function getIvRank(ticker: string, days = 252): IvRank | null {
  const rows = loadIvSnapshots(ticker, days);
  if (rows.length === 0) return null;
  return ivRankFromSeries(dailyAtmIv(rows));
}

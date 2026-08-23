/**
 * Markets-desk preferences — the pure half of lib/watchlist.ts.
 *
 * Split out because the desk is a client component and needs these types, the
 * defaults, and the symbol validator, while `lib/watchlist.ts` imports the DB
 * and must never reach a browser bundle. Nothing here touches storage.
 */

import { DEFAULT_HULL, type HullMode, type HullSettings, type HullSource } from "@/lib/hull";
import type { BarInterval, BarRange } from "@/lib/yahoo";

/** Hard cap so the grid (and the Yahoo fan-out behind it) stays bounded. */
export const MAX_WATCHLIST = 24;

export type MarketsPrefs = {
  range: BarRange;
  interval: BarInterval;
  /** Charts per row in the grid. 1 is the single-chart "focus" view. */
  columns: 1 | 2 | 3;
  hull: HullSettings;
  /** Pine's `visualSwitch` — draw the band, or just the leading line. */
  showBand: boolean;
  /** Pine's `candleCol` — tint the candles with the Hull's trend color. */
  colorCandles: boolean;
  /** Volume histogram under the price pane. Not in the Pine study; chart furniture. */
  showVolume: boolean;
};

export const DEFAULT_PREFS: MarketsPrefs = {
  range: "6mo",
  interval: "1d",
  columns: 2,
  hull: DEFAULT_HULL,
  showBand: true,
  colorCandles: false,
  showVolume: true,
};

/**
 * The timeframe buttons. Each pairs a lookback with the bar size that makes it
 * readable, the way a charting platform's top bar does — a 5-day window of
 * daily bars is five candles, and a 5-year window of hourly bars is 8,000.
 *
 * Every pair also clears the Hull's warm-up: the shortest here is ~130 bars,
 * comfortably past a 55-length study.
 */
export const TIMEFRAMES: { label: string; range: BarRange; interval: BarInterval }[] = [
  { label: "5D", range: "5d", interval: "15m" },
  { label: "1M", range: "1mo", interval: "1h" },
  { label: "3M", range: "3mo", interval: "1d" },
  { label: "6M", range: "6mo", interval: "1d" },
  { label: "1Y", range: "1y", interval: "1d" },
  { label: "2Y", range: "2y", interval: "1d" },
  { label: "5Y", range: "5y", interval: "1wk" },
  { label: "Max", range: "max", interval: "1mo" },
];

/**
 * Normalize user input into a symbol Yahoo will recognise: uppercase, trimmed,
 * no stray `$`. Returns null for anything that can't be a ticker, so a typo
 * never lands in the stored list.
 */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/^\$/, "");
  if (!s) return null;
  // Letters, digits, and the punctuation real Yahoo symbols use:
  // `BRK-B`, `BTC-USD`, `^GSPC`, `ES=F`, `EURUSD=X`, `BMW.DE`.
  if (!/^[\^A-Z0-9][A-Z0-9.\-=]{0,14}$/.test(s)) return null;
  return s;
}

const MODES: HullMode[] = ["Hma", "Ehma", "Thma"];
const SOURCES: HullSource[] = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"];
export const HULL_MODES = MODES;
export const HULL_SOURCES = SOURCES;

const INTERVALS: BarInterval[] = ["5m", "15m", "30m", "1h", "1d", "1wk", "1mo"];
const RANGES: BarRange[] = ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"];

/**
 * Coerce an arbitrary stored/posted object into valid prefs, field by field.
 * Anything unrecognised falls back to its default, so a hand-edited DB row or a
 * blob written before a field existed can't break the desk.
 */
export function coercePrefs(input: unknown): MarketsPrefs {
  const o = (input ?? {}) as Record<string, unknown>;
  const h = (o.hull ?? {}) as Record<string, unknown>;

  const num = (v: unknown, fb: number, lo: number, hi: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
  };
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);

  return {
    range: RANGES.includes(o.range as BarRange) ? (o.range as BarRange) : DEFAULT_PREFS.range,
    interval: INTERVALS.includes(o.interval as BarInterval)
      ? (o.interval as BarInterval)
      : DEFAULT_PREFS.interval,
    columns: ([1, 2, 3] as const).includes(o.columns as 1 | 2 | 3)
      ? (o.columns as 1 | 2 | 3)
      : DEFAULT_PREFS.columns,
    hull: {
      mode: MODES.includes(h.mode as HullMode) ? (h.mode as HullMode) : DEFAULT_HULL.mode,
      length: Math.round(num(h.length, DEFAULT_HULL.length, 2, 400)),
      lengthMult: num(h.lengthMult, DEFAULT_HULL.lengthMult, 0.1, 10),
      source: SOURCES.includes(h.source as HullSource) ? (h.source as HullSource) : DEFAULT_HULL.source,
    },
    showBand: bool(o.showBand, DEFAULT_PREFS.showBand),
    colorCandles: bool(o.colorCandles, DEFAULT_PREFS.colorCandles),
    showVolume: bool(o.showVolume, DEFAULT_PREFS.showVolume),
  };
}

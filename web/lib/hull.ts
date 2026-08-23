/**
 * Hull Suite — a faithful port of the TradingView Pine v4 study
 * "Hull Suite by InSilico" (Basic Hull Ma Pack).
 *
 * This is the *only* indicator the markets desk draws, so it is worth porting
 * exactly rather than approximating with the generic `sma`/`ema` in
 * lib/technicals.ts (which return a single latest value; a chart needs the whole
 * series, aligned bar-for-bar with the candles).
 *
 * The original:
 *
 *   HMA(src, len)  = wma(2 * wma(src, len/2) - wma(src, len), round(sqrt(len)))
 *   EHMA(src, len) = ema(2 * ema(src, len/2) - ema(src, len), round(sqrt(len)))
 *   THMA(src, len) = wma(wma(src, len/3)*3 - wma(src, len/2) - wma(src, len), len)
 *
 *   Mode: "Hma" → HMA(src, L) · "Ehma" → EHMA(src, L) · "Thma" → THMA(src, L/2)
 *   where L = int(length * lengthMult)
 *
 *   MHULL = HULL[0]      (the leading line)
 *   SHULL = HULL[2]      (the same line lagged two bars — the band's other edge)
 *   trend = HULL > HULL[2]   → green, else red
 *
 * Two Pine details that are easy to get wrong and are reproduced here:
 *
 *  1. Pine's moving-average `length` is an integer, and a float argument is
 *     implicitly truncated. `len/2` with len=55 is therefore a 27-bar window,
 *     not 27.5. `round(sqrt(len))` genuinely rounds. See `intLen`.
 *  2. `na` propagates. A moving average whose window contains an undefined value
 *     is itself undefined, which is why the first ~len bars of a Hull series are
 *     null instead of being quietly seeded from a short window.
 *
 * Everything here is pure: feed it closes (or whichever source) oldest-first.
 */

/** The three Hull variations the study offers. Matches the Pine option strings. */
export type HullMode = "Hma" | "Ehma" | "Thma";

/** Which price each bar contributes. Mirrors the Pine `src` input. */
export type HullSource = "close" | "open" | "high" | "low" | "hl2" | "hlc3" | "ohlc4";

export type HullSettings = {
  mode: HullMode;
  /** Pine's `length`. 55 for swing entries, 180–200 for floating S/R. */
  length: number;
  /** Pine's `lengthMult` — view a higher timeframe as a straight band. */
  lengthMult: number;
  source: HullSource;
};

export const DEFAULT_HULL: HullSettings = {
  mode: "Hma",
  length: 55,
  lengthMult: 1,
  source: "close",
};

/** An OHLC bar, oldest-first. `t` is epoch milliseconds at the bar's open. */
export type Bar = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

/** Pine's implicit float→int cast on a MA length: truncate, floor of 1. */
function intLen(n: number): number {
  const t = Math.trunc(n);
  return t < 1 ? 1 : t;
}

/**
 * Weighted moving average, full series. Weight `i+1` on the i-th oldest bar of
 * the window, so the newest bar carries weight `period`.
 *
 * Nulls in the input propagate: any window containing one yields null, which is
 * how Pine's `na` behaves when a MA is composed out of other MAs.
 */
export function wmaSeries(values: (number | null)[], period: number): (number | null)[] {
  const p = intLen(period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  const denom = (p * (p + 1)) / 2;
  for (let i = p - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < p; k++) {
      const v = values[i - p + 1 + k];
      if (v == null || !Number.isFinite(v)) {
        ok = false;
        break;
      }
      sum += v * (k + 1);
    }
    if (ok) out[i] = sum / denom;
  }
  return out;
}

/**
 * Exponential moving average, full series, seeded with the SMA of the first
 * `period` values — the same seeding `lib/technicals.ts` uses and what Pine's
 * `ema` settles to. Leading nulls are skipped, then propagated back into the
 * output so alignment with the input is preserved; a null appearing *after* the
 * series has started truncates it (there is no defined way to carry an EMA
 * across a gap).
 */
export function emaSeries(values: (number | null)[], period: number): (number | null)[] {
  const p = intLen(period);
  const out: (number | null)[] = new Array(values.length).fill(null);

  let start = 0;
  while (start < values.length && (values[start] == null || !Number.isFinite(values[start]!))) start++;
  if (values.length - start < p) return out;

  let seed = 0;
  for (let i = start; i < start + p; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) return out; // gap inside the seed window
    seed += v;
  }
  let e = seed / p;
  out[start + p - 1] = e;

  const k = 2 / (p + 1);
  for (let i = start + p; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) break;
    e = v * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** Element-wise combine of two aligned series; null if either side is null. */
function zip(
  a: (number | null)[],
  b: (number | null)[],
  fn: (x: number, y: number) => number,
): (number | null)[] {
  const out: (number | null)[] = new Array(a.length).fill(null);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x != null && y != null) out[i] = fn(x, y);
  }
  return out;
}

/** HMA — the classic Hull moving average. */
export function hmaSeries(src: (number | null)[], length: number): (number | null)[] {
  const half = wmaSeries(src, length / 2);
  const full = wmaSeries(src, length);
  const raw = zip(half, full, (h, f) => 2 * h - f);
  return wmaSeries(raw, Math.round(Math.sqrt(intLen(length))));
}

/** EHMA — the same construction built out of EMAs instead of WMAs. */
export function ehmaSeries(src: (number | null)[], length: number): (number | null)[] {
  const half = emaSeries(src, length / 2);
  const full = emaSeries(src, length);
  const raw = zip(half, full, (h, f) => 2 * h - f);
  return emaSeries(raw, Math.round(Math.sqrt(intLen(length))));
}

/** THMA — the triple-weighted variation. Pine feeds it `length/2`, not `length`. */
export function thmaSeries(src: (number | null)[], length: number): (number | null)[] {
  const third = wmaSeries(src, length / 3);
  const half = wmaSeries(src, length / 2);
  const full = wmaSeries(src, length);
  const raw: (number | null)[] = new Array(src.length).fill(null);
  for (let i = 0; i < src.length; i++) {
    const a = third[i];
    const b = half[i];
    const c = full[i];
    if (a != null && b != null && c != null) raw[i] = a * 3 - b - c;
  }
  return wmaSeries(raw, length);
}

/** Pull the configured source price out of a bar (Pine's `src` input). */
export function sourceOf(bar: Bar, source: HullSource): number {
  switch (source) {
    case "open":
      return bar.open;
    case "high":
      return bar.high;
    case "low":
      return bar.low;
    case "hl2":
      return (bar.high + bar.low) / 2;
    case "hlc3":
      return (bar.high + bar.low + bar.close) / 3;
    case "ohlc4":
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    default:
      return bar.close;
  }
}

/** The raw HULL line — Pine's `_hull`, before the MHULL/SHULL split. */
export function hullSeries(src: number[], settings: HullSettings): (number | null)[] {
  const len = intLen(settings.length * settings.lengthMult);
  const values: (number | null)[] = src;
  switch (settings.mode) {
    case "Ehma":
      return ehmaSeries(values, len);
    case "Thma":
      // Pine: THMA is called with len/2, unlike the other two.
      return thmaSeries(values, len / 2);
    default:
      return hmaSeries(values, len);
  }
}

/**
 * One bar of the plotted study: the band's two edges and the trend they encode.
 * `up` is null until both edges exist (the study plots nothing before that).
 */
export type HullPoint = {
  /** Pine's MHULL — HULL[0]. */
  mhull: number | null;
  /** Pine's SHULL — HULL[2], the band's trailing edge. */
  shull: number | null;
  /** HULL > HULL[2] — green when true, red when false. */
  up: boolean | null;
};

/**
 * The full study, aligned bar-for-bar with `bars`.
 *
 * `crossover(MHULL, SHULL)` and `crossover(SHULL, MHULL)` — the study's two
 * alert conditions — are exactly the bars where `up` changes, so callers read
 * signals off the `up` column rather than recomputing crosses.
 */
export function hullSuite(bars: Bar[], settings: HullSettings = DEFAULT_HULL): HullPoint[] {
  const src = bars.map((b) => sourceOf(b, settings.source));
  const hull = hullSeries(src, settings);
  return hull.map((h, i) => {
    const lag = i >= 2 ? hull[i - 2] : null;
    return { mhull: h, shull: lag, up: h != null && lag != null ? h > lag : null };
  });
}

/**
 * The at-a-glance read for a whole watchlist: which way each symbol's Hull is
 * pointing, how long it has been pointing that way, and what price it flipped
 * at. This is what makes the desk scannable across a dozen tickers — the chart
 * is the detail view, this is the column you sort by.
 */
export type HullTrend = {
  /** Current direction, or null if there isn't enough history to plot. */
  direction: "up" | "down" | null;
  /** Bars since the last flip. 0 means it flipped on the latest bar. */
  barsSince: number | null;
  /** Epoch ms of the flip bar. */
  flippedAt: number | null;
  /** Close on the flip bar — the reference the current move is measured from. */
  flipPrice: number | null;
  /** Latest close vs `flipPrice`, as a fraction (0.031 = +3.1%). */
  changeSinceFlip: number | null;
};

export function hullTrend(bars: Bar[], points: HullPoint[]): HullTrend {
  const empty: HullTrend = {
    direction: null,
    barsSince: null,
    flippedAt: null,
    flipPrice: null,
    changeSinceFlip: null,
  };

  let last = points.length - 1;
  while (last >= 0 && points[last].up == null) last--;
  if (last < 0) return empty;

  const direction = points[last].up ? "up" : "down";

  // Walk back to the bar where `up` first took its current value.
  let flip = last;
  while (flip > 0 && points[flip - 1].up === points[last].up) flip--;
  // If we walked all the way to the first defined point there was no observed
  // flip — the trend predates our window, so `barsSince` is a lower bound and
  // the flip reference is that first bar.
  const flipBar = bars[flip];
  const lastClose = bars[last]?.close ?? null;

  return {
    direction,
    barsSince: last - flip,
    flippedAt: flipBar?.t ?? null,
    flipPrice: flipBar?.close ?? null,
    changeSinceFlip:
      lastClose != null && flipBar?.close ? lastClose / flipBar.close - 1 : null,
  };
}

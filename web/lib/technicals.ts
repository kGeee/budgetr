/**
 * Price technicals — pure functions over daily bars, for the analysis desk's
 * per-holding risk/momentum read. Nothing here fetches; feed it closes (or OHLC)
 * oldest-first. Everything returns null when there isn't enough data rather than
 * a misleading number.
 */

export type Bar = { high: number; low: number; close: number };

/** Simple moving average of the last `period` values, or null if too few. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

/** Exponential moving average (final value), or null if too few. */
export function ema(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  // Seed with the SMA of the first `period` values, then walk forward.
  let e = 0;
  for (let i = 0; i < period; i++) e += values[i];
  e /= period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/**
 * Wilder's RSI over `period` (default 14), 0–100, or null if too few closes.
 * >70 overbought, <30 oversold by convention.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(ch, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-ch, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Average True Range over `period` (default 14) in price units, or null. */
export function atr(bars: Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose),
    );
    trs.push(tr);
  }
  // Wilder smoothing.
  let a = 0;
  for (let i = 0; i < period; i++) a += trs[i];
  a /= period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

/** Annualized realized volatility from daily log returns (percent), or null. */
export function realizedVol(closes: number[], tradingDays = 252): number | null {
  if (closes.length < 20) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varc) * Math.sqrt(tradingDays) * 100;
}

/** Where the latest close sits in its high–low range over the series, 0–100. */
export function pctOf52wRange(closes: number[]): number | null {
  if (closes.length < 2) return null;
  const hi = Math.max(...closes);
  const lo = Math.min(...closes);
  if (!(hi > lo)) return null;
  return ((closes[closes.length - 1] - lo) / (hi - lo)) * 100;
}

/** Percent change over the last `days` trading bars, or null if too few. */
export function momentum(closes: number[], days: number): number | null {
  if (closes.length <= days || days <= 0) return null;
  const past = closes[closes.length - 1 - days];
  const now = closes[closes.length - 1];
  if (!(past > 0)) return null;
  return ((now - past) / past) * 100;
}

/** Worst peak-to-trough drawdown over the series, as a negative percent. */
export function maxDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) worst = Math.min(worst, (c - peak) / peak);
  }
  return worst * 100;
}

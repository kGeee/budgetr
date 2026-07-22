/**
 * Correlation & beta from daily close series. Pure math for the analysis desk:
 * how each holding moves with the market (beta), how holdings move together
 * (pairwise correlation), and a portfolio-weighted beta. Feed it close series
 * keyed by date; it aligns on common dates and works in log/simple returns.
 */

export type CloseSeries = { date: string; close: number }[];

/** Daily simple returns aligned to two series' common dates. */
export function alignedReturns(a: CloseSeries, b: CloseSeries): { ra: number[]; rb: number[] } {
  const mapB = new Map(b.map((p) => [p.date, p.close]));
  const dates: string[] = [];
  const ca: number[] = [];
  const cb: number[] = [];
  for (const p of a) {
    const bc = mapB.get(p.date);
    if (bc != null && p.close > 0 && bc > 0) {
      dates.push(p.date);
      ca.push(p.close);
      cb.push(bc);
    }
  }
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    ra.push(ca[i] / ca[i - 1] - 1);
    rb.push(cb[i] / cb[i - 1] - 1);
  }
  return { ra, rb };
}

/** Pearson correlation of two equal-length return arrays, or null. */
export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Beta of an asset vs a benchmark: cov(asset, bench) / var(bench). */
export function beta(asset: number[], bench: number[]): number | null {
  const n = Math.min(asset.length, bench.length);
  if (n < 3) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += asset[i];
    mb += bench[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let varb = 0;
  for (let i = 0; i < n; i++) {
    cov += (asset[i] - ma) * (bench[i] - mb);
    varb += (bench[i] - mb) ** 2;
  }
  if (varb <= 0) return null;
  return cov / varb;
}

/** Beta of a holding's close series against a benchmark's, on common dates. */
export function betaTo(asset: CloseSeries, bench: CloseSeries): number | null {
  const { ra, rb } = alignedReturns(asset, bench);
  return beta(ra, rb);
}

/** Correlation of a holding's close series against another's, on common dates. */
export function correlationTo(a: CloseSeries, b: CloseSeries): number | null {
  const { ra, rb } = alignedReturns(a, b);
  return pearson(ra, rb);
}

/** Value-weighted portfolio beta; ignores holdings with unknown beta. */
export function portfolioBeta(holdings: Array<{ value: number; beta: number | null }>): number | null {
  let wsum = 0;
  let bsum = 0;
  for (const h of holdings) {
    if (h.beta == null || !(h.value > 0)) continue;
    wsum += h.value;
    bsum += h.value * h.beta;
  }
  return wsum > 0 ? bsum / wsum : null;
}

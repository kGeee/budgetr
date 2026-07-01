/**
 * Best-effort Black-Scholes option Greeks.
 *
 * Pure math (no DB / network), driven by the live implied volatility Yahoo hands
 * back with its option chain. Everything is per-contract and per-share (delta,
 * gamma) or already scaled to a trader-friendly unit (theta per calendar day,
 * vega/rho per 1 percentage-point move). Callers multiply by contracts × 100 for
 * a position-level exposure. Every field is null when an input is missing or
 * degenerate (no IV, expired, zero price), so the UI can show an em dash.
 */

import { daysToExpiry, type ParsedOption } from "./options";

/** Constant short-rate assumption — good enough for display-grade Greeks. */
export const RISK_FREE_RATE = 0.045;

const DAYS_PER_YEAR = 365;

export type Greeks = {
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
};

const NULL_GREEKS: Greeks = { delta: null, gamma: null, theta: null, vega: null, rho: null };

/** Standard normal PDF. */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Standard normal CDF via the Abramowitz-Stegun rational approximation. */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = normPdf(x);
  const p =
    d *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/**
 * Compute the Greeks for one option contract given its live underlying price and
 * implied volatility. Days-to-expiry is derived from the parsed OCC expiry, so
 * the caller only threads what varies per quote. Returns all-null when any input
 * is unusable (missing/zero IV or price, or the contract is already expired).
 */
export function computeGreeks(
  parsed: ParsedOption,
  underlyingPrice: number | null | undefined,
  iv: number | null | undefined,
  rate: number = RISK_FREE_RATE,
): Greeks {
  const S = underlyingPrice;
  const sigma = iv;
  if (
    S == null ||
    !Number.isFinite(S) ||
    S <= 0 ||
    sigma == null ||
    !Number.isFinite(sigma) ||
    sigma <= 0
  ) {
    return NULL_GREEKS;
  }

  const dte = daysToExpiry(parsed.expiry);
  if (dte <= 0) return NULL_GREEKS;

  const T = dte / DAYS_PER_YEAR;
  const K = parsed.strike;
  const sqrtT = Math.sqrt(T);
  const isCall = parsed.right === "call";

  const d1 = (Math.log(S / K) + (rate + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normPdf(d1);
  const discount = Math.exp(-rate * T);

  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * sqrtT);
  const vega = (S * pdf * sqrtT) / 100; // per 1% change in IV

  // Theta per calendar day (the − term is share-price time decay).
  const thetaAnnual = isCall
    ? -(S * pdf * sigma) / (2 * sqrtT) - rate * K * discount * normCdf(d2)
    : -(S * pdf * sigma) / (2 * sqrtT) + rate * K * discount * normCdf(-d2);
  const theta = thetaAnnual / DAYS_PER_YEAR;

  const rho = isCall
    ? (K * T * discount * normCdf(d2)) / 100
    : (-K * T * discount * normCdf(-d2)) / 100;

  return { delta, gamma, theta, vega, rho };
}

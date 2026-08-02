/**
 * Value an options position at any spot AND any date — the engine behind the
 * OptionStrat-style "value now" curve and the price × date P/L heatmap.
 *
 * `lib/payoff.ts` gives the exact payoff at EXPIRY (intrinsic value); this adds
 * the time dimension by Black-Scholes-pricing every leg at an explicit
 * time-to-expiry, so you can see how the position's P/L evolves before expiry.
 * Pure math — no I/O — so it's cheap to resample on every slider tick and unit
 * testable. At T = 0 it reduces exactly to the expiry payoff.
 */

import { bsPrice, RISK_FREE_RATE } from "./greeks";
import { CONTRACT_SIZE, type PayoffLeg } from "./payoff";

const DAYS_PER_YEAR = 365;

/** Per-leg implied vol lookup (a leg's own IV, with an ATM fallback). */
export type SigmaFor = (leg: PayoffLeg) => number;

/** Theoretical $ value of the whole position at spot `S`, `T` years to expiry. */
export function positionValue(legs: PayoffLeg[], S: number, T: number, sigmaFor: SigmaFor): number {
  let v = 0;
  for (const l of legs) {
    const shares = l.quantity ?? 0;
    if (!shares) continue;
    v += shares * bsPrice(l.parsed.right, S, l.parsed.strike, Math.max(0, T), sigmaFor(l));
  }
  return v;
}

/** Net cash paid to enter (signed): debit > 0, credit < 0. */
export function positionCost(legs: PayoffLeg[]): number {
  return legs.reduce((s, l) => s + (l.costBasis ?? 0), 0);
}

/** Position P&L in $ at spot `S`, `T` years to expiry (value − entry cost). */
export function positionPnl(legs: PayoffLeg[], S: number, T: number, sigmaFor: SigmaFor): number {
  return positionValue(legs, S, T, sigmaFor) - positionCost(legs);
}

/**
 * Sample the P&L vs. underlying-price curve at a fixed date (`daysFromNow` after
 * today). `daysFromNow >= dte` gives the expiry payoff. Shares the x-domain with
 * the expiry curve so the two overlay cleanly.
 */
export function theoCurve(
  legs: PayoffLeg[],
  opts: { min: number; max: number; dte: number; daysFromNow: number; sigmaFor: SigmaFor; steps?: number },
): { price: number; pnl: number }[] {
  const { min, max, dte, daysFromNow, sigmaFor, steps = 96 } = opts;
  const T = Math.max(0, dte - daysFromNow) / DAYS_PER_YEAR;
  const out: { price: number; pnl: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const price = min + (i / (steps - 1)) * (max - min);
    out.push({ price, pnl: positionPnl(legs, price, T, sigmaFor) });
  }
  return out;
}

export type PnlMatrix = {
  /** Underlying prices, ascending (grid rows). */
  prices: number[];
  /** Days-from-now per column, ascending from 0 (today) to `dte` (expiry). */
  days: number[];
  /** cells[priceIndex][dayIndex] = P&L in dollars. */
  cells: number[][];
  /** Largest |P&L| in the grid — used to normalize the colour scale. */
  maxAbs: number;
};

/**
 * The signature OptionStrat grid: P&L across a range of underlying prices (rows)
 * and dates from today to expiry (columns). Each cell is Black-Scholes P&L, ready
 * to colour green (profit) / red (loss) by magnitude vs. `maxAbs`.
 */
export function pnlMatrix(
  legs: PayoffLeg[],
  opts: { min: number; max: number; dte: number; sigmaFor: SigmaFor; priceSteps?: number; dateSteps?: number },
): PnlMatrix {
  const { min, max, dte, sigmaFor, priceSteps = 17, dateSteps = 10 } = opts;
  const nCols = Math.max(2, dateSteps);
  const nRows = Math.max(2, priceSteps);

  const days: number[] = [];
  for (let j = 0; j < nCols; j++) days.push(Math.round((j / (nCols - 1)) * dte));

  const prices: number[] = [];
  for (let i = 0; i < nRows; i++) prices.push(min + (i / (nRows - 1)) * (max - min));

  const cells: number[][] = [];
  let maxAbs = 0;
  for (let i = 0; i < nRows; i++) {
    const row: number[] = [];
    for (let j = 0; j < nCols; j++) {
      const T = Math.max(0, dte - days[j]) / DAYS_PER_YEAR;
      const pnl = positionPnl(legs, prices[i], T, sigmaFor);
      row.push(pnl);
      if (Math.abs(pnl) > maxAbs) maxAbs = Math.abs(pnl);
    }
    cells.push(row);
  }
  return { prices, days, cells, maxAbs };
}

export { CONTRACT_SIZE, RISK_FREE_RATE };

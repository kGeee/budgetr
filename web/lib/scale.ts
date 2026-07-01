/**
 * Display-only obfuscation scale ("privacy mode").
 *
 * When active, every money amount that flows through `formatCurrency` /
 * `formatCompactCurrency` is divided by `factor` (k) before formatting, so the
 * figures on screen read as 1/k of reality. This is purely cosmetic — no stored
 * data or calculation is touched, and percentages (being ratios) are unaffected.
 *
 * The factor is the single source of truth held in the `obf` cookie. Because the
 * value lives in module scope, each runtime keeps its own copy:
 *   • Server — set per request in the root layout from the cookie, before the
 *     page's server components format anything. (Single-user, local app, so the
 *     shared module value across requests is acceptable.)
 *   • Client — set by <ScaleInit> during render, before any currency renders, so
 *     hydrated output matches the server HTML (no mismatch).
 */

export const OBF_COOKIE = "obf";
export const DEFAULT_K = 10;

let factor = 1; // active divisor; 1 = privacy mode off

export function setScaleFactor(k: number): void {
  factor = Number.isFinite(k) && k > 1 ? k : 1;
}

export function getScaleFactor(): number {
  return factor;
}

/** Map a real amount to the value that should actually be displayed. */
export function scaleForDisplay(amount: number): number {
  return factor === 1 ? amount : amount / factor;
}

/** Parse the cookie value into a usable factor (defaults to 1 / disabled). */
export function factorFromCookie(value: string | undefined): number {
  const k = Number(value);
  return Number.isFinite(k) && k > 1 ? k : 1;
}

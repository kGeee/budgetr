/**
 * Display-only privacy mode.
 *
 * When active, every absolute money amount that flows through `formatCurrency` /
 * `formatCompactCurrency` / `formatMoney` is masked out (rendered as dots) rather
 * than shown. This is purely cosmetic — no stored data or calculation is touched,
 * and percentages (being ratios, not absolute figures) are unaffected.
 *
 * The on/off flag is the single source of truth held in the `obf` cookie. Because
 * the value lives in module scope, each runtime keeps its own copy:
 *   • Server — set per request in the root layout from the cookie, before the
 *     page's server components format anything. (Single-user, local app, so the
 *     shared module value across requests is acceptable.)
 *   • Client — set by <ScaleInit> during render, before any currency renders, so
 *     hydrated output matches the server HTML (no mismatch).
 */

export const OBF_COOKIE = "obf";

let hidden = false; // true = privacy mode on (dollar values masked)

export function setHidden(on: boolean): void {
  hidden = !!on;
}

export function isHidden(): boolean {
  return hidden;
}

/**
 * Parse the cookie value into the on/off flag. Any non-empty, non-"0" value means
 * hidden — which also keeps older `obf=<k>` cookies (from the divide-by-k era)
 * reading as "on".
 */
export function hiddenFromCookie(value: string | undefined): boolean {
  return !!value && value !== "0";
}

/**
 * Keystroke rules for a money field.
 *
 * Pulled out of the component because the bug it prevents is invisible in
 * rendered markup and only shows up mid-typing: a controlled input that stores
 * `Number(text)` and renders `String(value)` cannot hold a trailing decimal
 * point. You type "6." → it stores 6 → it re-renders "6" → the point you just
 * typed is gone, and the field appears to refuse decimals entirely.
 *
 * The fix is to keep what was typed and parse alongside it, which needs one
 * rule: which drafts are worth keeping.
 */

/** Digits, at most one point, at most two decimals. Empty is allowed (cleared). */
const MONEY_DRAFT = /^\d{0,9}(\.\d{0,2})?$/;

/**
 * Should this keystroke be accepted into the field?
 *
 * Deliberately permits states that aren't valid numbers yet — "", "6.", "." —
 * because they're all on the way to one, and rejecting them is what makes a
 * field feel broken.
 */
export function acceptsMoneyDraft(raw: string): boolean {
  if (raw === "") return true;
  if (raw === ".") return true;
  return MONEY_DRAFT.test(raw);
}

/**
 * The numeric value a draft currently represents, or null when it represents
 * nothing yet. "6." is 6 — the trailing point is a typing state, not a value.
 */
export function parseMoneyDraft(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === ".") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * What to show when the field isn't being typed into. Kept separate so a value
 * arriving from elsewhere (a scan, a tip preset) displays cleanly rather than
 * as whatever float formatting produced.
 */
export function formatMoneyDraft(value: number | null): string {
  if (value == null) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

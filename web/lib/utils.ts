import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { scaleForDisplay } from "./scale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  currency = "USD",
  opts: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    ...opts,
  }).format(scaleForDisplay(amount));
}

export function formatCompactCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(scaleForDisplay(amount));
}

/**
 * A human-friendly display name for a transaction. Prefers Plaid's clean
 * `merchantName`; otherwise strips the noise from the raw descriptor
 * (reference numbers, store codes, asterisks, location cruft) so
 * "SQ *BLUE BOTTLE 00123 OAKLAND CA" reads as "Blue Bottle Oakland Ca".
 */
export function cleanTransactionName(name: string, merchantName?: string | null): string {
  if (merchantName && merchantName.trim()) return merchantName.trim();

  let s = ` ${name} `
    .replace(/\*+/g, " ") // asterisks / SQ* POS prefixes
    // Strip leading payment-processor prefixes (Square, Toast, PayPal, etc.)
    .replace(/^\s*(sq|tst|pp|paypal|pypl|sp|pos|cke|ic|ckecom)\b/i, " ")
    .replace(/#?\b\d[\d.\-/]{2,}\b/g, " ") // long reference / store numbers
    .replace(/\b\d+\b/g, " ") // standalone numbers
    .replace(/\b[A-Z]{2,}\d+[A-Z\d]*\b/g, " ") // alphanumeric codes like POS1234
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!s) return name.trim();

  // De-shout ALL-CAPS tokens so they read naturally; leave short acronyms.
  s = s
    .split(" ")
    .map((w) => (/^[A-Z]{3,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(" ");

  return s || name.trim();
}

// ── Vendor name similarity ────────────────────────────────────────────────────
// Lightweight, dependency-free fuzzy matching used to auto-suggest vendors that
// look like the same merchant ("Amazon" / "AMZN Mktp" / "Amazon Prime") so they
// can be merged in one click. Combines trigram overlap (catches typos / codes)
// with token overlap (catches word reordering) plus a substring containment
// boost. Returns a score in [0, 1].

function normalizeVendor(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s.replace(/\s+/g, "")} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Similarity between two vendor display names, in [0, 1] (1 = identical). */
export function vendorSimilarity(a: string, b: string): number {
  const na = normalizeVendor(a);
  const nb = normalizeVendor(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const tri = jaccard(trigrams(na), trigrams(nb));
  const tok = jaccard(new Set(na.split(" ")), new Set(nb.split(" ")));
  // One name containing the other is a strong same-merchant signal.
  const contained = na.includes(nb) || nb.includes(na) ? 0.3 : 0;

  return Math.min(1, 0.6 * tri + 0.4 * tok + contained);
}

export type VendorSuggestion<T> = { item: T; score: number };

/**
 * Rank `candidates` by name similarity to `target`, keeping only matches at or
 * above `threshold` (default 0.45) and returning the top `limit` (default 3).
 */
export function rankSimilarVendors<T>(
  target: string,
  candidates: T[],
  nameOf: (c: T) => string,
  opts: { threshold?: number; limit?: number } = {},
): VendorSuggestion<T>[] {
  const { threshold = 0.45, limit = 3 } = opts;
  return candidates
    .map((item) => ({ item, score: vendorSimilarity(target, nameOf(item)) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Net worth treats credit & loan balances as liabilities (subtracted). */
export function isLiability(accountType: string): boolean {
  return accountType === "credit" || accountType === "loan";
}

/** Signed contribution of an account to net worth. */
export function signedBalance(accountType: string, currentBalance: number | null): number {
  const b = currentBalance ?? 0;
  return isLiability(accountType) ? -b : b;
}

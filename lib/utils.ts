import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
  }).format(amount);
}

export function formatCompactCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
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

/** Net worth treats credit & loan balances as liabilities (subtracted). */
export function isLiability(accountType: string): boolean {
  return accountType === "credit" || accountType === "loan";
}

/** Signed contribution of an account to net worth. */
export function signedBalance(accountType: string, currentBalance: number | null): number {
  const b = currentBalance ?? 0;
  return isLiability(accountType) ? -b : b;
}

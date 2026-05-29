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

/** Net worth treats credit & loan balances as liabilities (subtracted). */
export function isLiability(accountType: string): boolean {
  return accountType === "credit" || accountType === "loan";
}

/** Signed contribution of an account to net worth. */
export function signedBalance(accountType: string, currentBalance: number | null): number {
  const b = currentBalance ?? 0;
  return isLiability(accountType) ? -b : b;
}

/**
 * What kind of thing is this holding?
 *
 * The holdings table used to be one flat list of everything, sorted by value,
 * under a header row of Qty · Price · Day · Value · % · P&L that only really
 * fits an equity. Cash rendered as "Qty 8,585.09 · Price $1.00 · P&L —", and an
 * option spread whose net value is negative sorted *below* a $2.27 dust
 * position because −$1,538 is a smaller number than $2.27.
 *
 * Grouping fixes that, and the grouping key already exists on every row — it
 * just wasn't being used. Pure and dependency-free so the table, the header
 * tiles and the tests all classify identically.
 */

import { parseOccSymbol } from "@/lib/options";

export type HoldingKind = "fund" | "stock" | "crypto" | "option" | "cash" | "other";

/** Minimal shape needed to classify — a subset of HoldingRow. */
export type Classifiable = {
  ticker: string | null;
  securityType: string | null;
  /** True for wallet-imported positions, which are always crypto. */
  fromWallet?: boolean;
};

/**
 * Plaid's `CUR:` prefix marks a currency balance held inside a brokerage
 * account. It is money, not a position: no cost basis, no day change, and
 * counting it as an investment overstates how invested you are. BCDXX and its
 * kin are sweep money-market funds — same story, different wrapper.
 */
export function isCashLike(h: Classifiable): boolean {
  const t = (h.ticker ?? "").toUpperCase();
  if (t.startsWith("CUR:")) return true;
  return (h.securityType ?? "").toLowerCase() === "cash";
}

export function classifyHolding(h: Classifiable): HoldingKind {
  if (h.ticker && parseOccSymbol(h.ticker)) return "option";
  if (isCashLike(h)) return "cash";
  if (h.fromWallet) return "crypto";

  const type = (h.securityType ?? "").toLowerCase();
  if (type === "crypto") return "crypto";
  if (type === "etf" || type === "mutual fund" || type === "fixed income") return "fund";
  if (type === "equity" || type === "stock") return "stock";

  // A `-USD` pair with no type is how manually-added coins arrive.
  if (/-USD$/.test((h.ticker ?? "").toUpperCase())) return "crypto";

  return "other";
}

/** Display order of the groups, and their headings. Cash last: it isn't a bet. */
export const KIND_ORDER: HoldingKind[] = ["fund", "stock", "crypto", "option", "cash", "other"];

export const KIND_LABEL: Record<HoldingKind, string> = {
  fund: "Funds & ETFs",
  stock: "Stocks",
  crypto: "Crypto",
  option: "Options",
  cash: "Cash & equivalents",
  other: "Other",
};

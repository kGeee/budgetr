/**
 * Receipt text → structured line items. Pure, deterministic, no network and no
 * model — which is the whole point: budgetr promises your data stays on this
 * machine, so the only thing that ever sees a receipt photo is the OS's on-device
 * text recognizer (lib/receipt/ocr.ts) and this file.
 *
 * The parse is rule-based, and rules on receipts are unusually reliable because
 * the format is a convention: description on the left, money right-aligned, a
 * totals block at the bottom keyed by well-known words. What we cannot do is
 * guess — so anything that doesn't fit is surfaced (`unparsed`, `discrepancy`)
 * rather than dropped or invented.
 */

import type { OcrLine, ParsedReceipt, ReceiptItem, ReceiptModifier } from "./types.js";

/**
 * A money token at the END of a line. Two decimal places are required on
 * purpose: it keeps "AKAMARU MODERN × 2" from reading its quantity as a price,
 * and receipts always print cents.
 *
 * The optional bracket is captured on BOTH sides of the currency symbol because
 * receipts write the upcharge as "($6.00)" — paren outside — and accounting
 * negatives as "$(6.00)". Group 1 tells the caller a bracket was there at all,
 * which is what separates a modifier's sub-price from a real line price.
 */
const TRAILING_MONEY =
  /(\()?\s*(-)?\$?\s?(-)?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})\s*(\))?\s*$/;

/** Any money token anywhere in a string — used for modifier prices. */
const INLINE_MONEY = /\$\s?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})/;

/** "× 2", "x2", "X 3" trailing the description. */
const TRAILING_QTY = /\s*[×xX]\s*(\d{1,3})\s*$/;

/** "2 ×", "3x" leading it. */
const LEADING_QTY = /^\s*(\d{1,3})\s*[×xX]\s+/;

/** "($21.00 ea.)", "@ $21.00", "21.00 each". */
const UNIT_PRICE = /(?:\$\s?(\d+(?:\.\d{2})?)\s*(?:ea\b|each\b))|(?:@\s*\$?\s?(\d+(?:\.\d{2})?))/i;

/** "(8.625%)" inside a tax label. */
const PERCENT = /\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/;

/**
 * Totals-block keywords, most specific first — "subtotal" has to beat "total",
 * and "total tax" has to beat both. Matching is on a normalized label so
 * punctuation and case don't matter.
 */
const TOTAL_KEYS: { key: "subtotal" | "tax" | "tip" | "total"; test: RegExp }[] = [
  { key: "subtotal", test: /\b(sub[\s-]?total|purchase subtotal|food total|items? total)\b/ },
  { key: "tax", test: /\b(sales tax|tax|vat|gst|hst)\b/ },
  { key: "tip", test: /\b(tip|gratuity|service charge)\b/ },
  { key: "total", test: /\b(grand total|order total|amount due|total)\b/ },
];

/**
 * Lines that are never items or totals — payment tails, headers, thank-yous.
 * Kept deliberately short: over-filtering loses real lines, and anything we drop
 * that had a price still shows up in `unparsed`.
 */
const NOISE =
  /^(thank you|thanks|customer copy|merchant copy|server|table|guests?|order\s*#|check\s*#|auth|approval|card\b|visa|mastercard|amex|discover|debit|credit|change due|cash|balance due|x{4,}|\*{4,}|-{3,}|={3,})/;

const norm = (s: string) => s.trim().toLowerCase().replace(/[.:•·]+/g, " ").replace(/\s+/g, " ");

function money(match: RegExpMatchArray): number {
  const negative = Boolean(match[2] ?? match[3]);
  // Groups 4 and 5 are the integer and cents parts; the regex cannot match
  // without them, so the assertion is a compile-time note, not a risk.
  const value = Number(`${match[4]!.replace(/,/g, "")}.${match[5]}`);
  return negative ? -value : value;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cluster OCR observations into visual rows.
 *
 * Two observations belong to the same row when their vertical extents overlap by
 * more than half the shorter one's height. That tolerance is what pairs a
 * left-column description with its right-column price while keeping consecutive
 * receipt lines apart, even when the photo is slightly rotated.
 */
export function groupIntoRows(lines: OcrLine[]): string[] {
  if (lines.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: OcrLine[][] = [];

  for (const line of sorted) {
    const row = rows[rows.length - 1];
    if (row) {
      // Compare against the row's current vertical band, not just its first
      // member, so a tall row accumulated left-to-right keeps attracting parts.
      const top = Math.min(...row.map((l) => l.y));
      const bottom = Math.max(...row.map((l) => l.y + l.h));
      const overlap = Math.min(bottom, line.y + line.h) - Math.max(top, line.y);
      const shorter = Math.min(bottom - top, line.h);
      if (shorter > 0 && overlap / shorter > 0.5) {
        row.push(line);
        continue;
      }
    }
    rows.push([line]);
  }

  return rows.map((row) =>
    [...row]
      .sort((a, b) => a.x - b.x)
      .map((l) => l.text.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * A row split into its description and its trailing price, if it has one.
 *
 * `parenthesised` carries the one typographic convention that actually changes
 * meaning: a bare price in brackets is a *sub*-price — the upcharge for a
 * modifier ("◆TAMAGO ($6.00)"), already included in the item's own price above
 * it. Treating it as a line price double-counts the receipt, which is exactly
 * what a $77 subtotal parsing as $83 looks like.
 */
type Row = { raw: string; label: string; amount: number | null; parenthesised: boolean };

function splitRow(raw: string): Row {
  const m = raw.match(TRAILING_MONEY);
  if (!m) return { raw, label: raw.trim(), amount: null, parenthesised: false };
  return {
    raw,
    label: raw.slice(0, m.index).trim(),
    amount: money(m),
    parenthesised: Boolean(m[1] ?? m[6]),
  };
}

/**
 * Parse already-grouped receipt rows.
 *
 * Exported separately from `parseReceipt` so tests can drive it with plain text
 * (which is also what a paste-the-text fallback would use) without fabricating
 * bounding boxes.
 */
export function parseReceiptRows(rawRows: string[]): ParsedReceipt {
  const rows = rawRows
    .map((r) => r.replace(/\s+/g, " ").trim())
    .filter((r) => r.length > 0)
    .map(splitRow);

  const totals: Record<"subtotal" | "tax" | "tip" | "total", number | null> = {
    subtotal: null,
    tax: null,
    tip: null,
    total: null,
  };
  let taxRatePct: number | null = null;

  // Which rows are part of the totals block. Found first so the item pass knows
  // where to stop, and so a "Tip" line never becomes an item.
  const totalRowIdx = new Set<number>();
  rows.forEach((row, i) => {
    if (row.amount == null) return;
    const label = norm(row.label);
    if (!label) return;
    for (const { key, test } of TOTAL_KEYS) {
      if (!test.test(label)) continue;
      // Keep the LAST occurrence: receipts that print a running total repeat the
      // word, and the bottom-most one is the real figure.
      totals[key] = row.amount;
      totalRowIdx.add(i);
      if (key === "tax") {
        const pct = row.label.match(PERCENT);
        if (pct) taxRatePct = Number(pct[1]);
      }
      break;
    }
  });

  // Items live above the first totals row. Anything after it that isn't a
  // recognized total is payment noise, not food.
  const firstTotalRow = Math.min(...[...totalRowIdx], rows.length);

  const items: ReceiptItem[] = [];
  const unparsed: string[] = [];
  let pending: ReceiptItem | null = null;

  const flush = () => {
    if (pending) items.push(pending);
    pending = null;
  };

  for (let i = 0; i < rows.length; i++) {
    if (totalRowIdx.has(i)) continue;
    const row = rows[i]!;
    const label = norm(row.label);

    if (i >= firstTotalRow) {
      // Below the totals block: only keep it if it looks like money we failed to
      // classify, so the user can see what we ignored.
      if (row.amount != null && label && !NOISE.test(label)) unparsed.push(row.raw);
      continue;
    }

    if (!label && row.amount == null) continue;
    if (label && NOISE.test(label)) continue;

    // A bracketed price under an item is that item's modifier upcharge, not a
    // new line. Falls through to the modifier branch below.
    const isSubPrice = row.parenthesised && pending != null;

    if (row.amount != null && row.label.trim() && !isSubPrice) {
      // A priced line starts a new item.
      flush();

      let name = row.label.trim();
      let quantity = 1;

      const trailing = name.match(TRAILING_QTY);
      const leading = name.match(LEADING_QTY);
      if (trailing) {
        quantity = Number(trailing[1]);
        name = name.slice(0, trailing.index).trim();
      } else if (leading) {
        quantity = Number(leading[1]);
        name = name.slice(leading[0].length).trim();
      }

      pending = {
        id: `it${items.length + 1}`,
        label: name || row.label.trim(),
        quantity: quantity > 0 ? quantity : 1,
        unitPrice: null,
        total: row.amount,
        modifiers: [],
      };
      continue;
    }

    // An unpriced line (or a bare parenthetical) belongs to the item above it.
    if (pending) {
      const text = row.raw.trim();

      const unit = text.match(UNIT_PRICE);
      if (unit && /^\(?\s*\$?\s?[\d.]+\s*(ea\b|each\b)/i.test(text.replace(/^\(/, ""))) {
        pending.unitPrice = Number(unit[1] ?? unit[2]);
        continue;
      }
      if (unit && pending.unitPrice == null && /\bea\b|each\b|@/i.test(text)) {
        pending.unitPrice = Number(unit[1] ?? unit[2]);
        continue;
      }

      const inline = text.match(INLINE_MONEY);
      const mod: ReceiptModifier = {
        label: text.replace(INLINE_MONEY, "").replace(/[()]/g, "").replace(/\s+/g, " ").trim(),
        price: inline ? Number(`${inline[1]!.replace(/,/g, "")}.${inline[2]}`) : null,
      };
      if (mod.label || mod.price != null) pending.modifiers.push(mod);
      continue;
    }

    // Above the first item with no price and nothing to attach to — merchant
    // name, address, date. Not interesting, and not an error.
  }
  flush();

  // Infer the missing corner of subtotal/tax/tip/total when three are known, so
  // an OCR miss on one line doesn't sink the whole split.
  const { subtotal, tax, tip, total } = totals;
  if (total != null && subtotal != null && tax != null && tip == null) {
    totals.tip = round2(total - subtotal - tax);
  } else if (total != null && subtotal != null && tip != null && tax == null) {
    totals.tax = round2(total - subtotal - tip);
  } else if (subtotal != null && tax != null && tip != null && total == null) {
    totals.total = round2(subtotal + tax + tip);
  }

  // Many receipts (this feature's own fixture included) print the amount paid as
  // a headline above the order. When OCR groups it with the check number it can
  // look like a priced item — a phantom line worth the entire bill. Drop a
  // leading item that exactly equals the total when real items follow it.
  if (items.length > 1 && totals.total != null && items[0]!.total === totals.total) {
    const rest = round2(items.slice(1).reduce((a, it) => a + it.total, 0));
    if (totals.subtotal == null || Math.abs(rest - totals.subtotal) < 0.01) items.shift();
  }

  const itemsTotal = round2(items.reduce((a, it) => a + it.total, 0));
  const discrepancy =
    totals.subtotal != null && Math.abs(itemsTotal - totals.subtotal) >= 0.01
      ? {
          itemsTotal,
          subtotal: totals.subtotal,
          difference: round2(itemsTotal - totals.subtotal),
        }
      : null;

  return {
    items,
    subtotal: totals.subtotal,
    tax: totals.tax,
    tip: totals.tip,
    total: totals.total,
    taxRatePct,
    discrepancy,
    unparsed,
  };
}

/** Parse OCR observations straight from the recognizer. */
export function parseReceipt(lines: OcrLine[]): ParsedReceipt {
  return parseReceiptRows(groupIntoRows(lines));
}

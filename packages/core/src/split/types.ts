/**
 * Receipt scanning + itemized splitting — shared types.
 *
 * Everything here is plain data so the parser, the allocator and the split modal
 * can share it without dragging server-only code into the browser bundle. The
 * OCR step (lib/receipt/ocr.ts) is the only server-only piece.
 */

/**
 * One recognized run of text with its box on the page, normalized to 0–1 with
 * the origin at the TOP-left (y grows downward, like CSS — Vision's own origin is
 * bottom-left and the helper flips it).
 *
 * Boxes matter because a receipt is two columns: the description and its price
 * are usually separate observations, and only their vertical overlap says they
 * belong to the same line.
 */
export type OcrLine = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** A modifier/option printed under an item ("CHICKEN", "◆TAMAGO ($6.00)"). */
export type ReceiptModifier = {
  label: string;
  /**
   * Price printed in the modifier's own text, when there is one. Informational
   * only — on every receipt format we've seen the parent item's right-hand price
   * already includes it, so the allocator never adds these.
   */
  price: number | null;
};

export type ReceiptItem = {
  /** Stable within one parse; the assignment map is keyed by it. */
  id: string;
  label: string;
  /** Units printed on the line ("AKAMARU MODERN × 2" → 2). Defaults to 1. */
  quantity: number;
  /** Per-unit price when the receipt prints one ("($21.00 ea.)"). */
  unitPrice: number | null;
  /** The line's own right-hand price. Authoritative — this is what gets split. */
  total: number;
  modifiers: ReceiptModifier[];
};

/**
 * A parsed receipt. Amounts are positive dollars in the receipt's own currency;
 * the caller applies the transaction's sign convention.
 *
 * `subtotal`/`tax`/`tip`/`total` are null when the receipt didn't print them (or
 * OCR missed them) — the UI asks rather than inventing a number.
 */
export type ParsedReceipt = {
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  total: number | null;
  /** Tax rate if printed as "Sales Tax (8.625%)" — display only. */
  taxRatePct: number | null;
  /**
   * Set when the item lines don't add up to the printed subtotal. Non-fatal: the
   * UI shows it and lets the user fix a line rather than silently splitting a
   * number that doesn't reconcile.
   */
  discrepancy: { itemsTotal: number; subtotal: number; difference: number } | null;
  /** Lines the parser could not place, kept so nothing is silently dropped. */
  unparsed: string[];
};

/**
 * Who ate what. `weights[participantId] = units` — a shared plate gives every
 * eater weight 1, and a two-bowl line eaten by two people is {a:1, b:1}. Three
 * buns where one person had two is {a:2, b:1}.
 *
 * One concept covers "split this evenly" and "I had two of these", which is why
 * the modal only ever has to show +/− per person rather than a mode switch.
 */
export type ItemAssignment = Record<string, number>;

/** `null` participant id means you — the same convention as split-math.ts. */
export const ME = "__me__";

/** Per-person outcome of an itemized split. Cents-exact by construction. */
export type PersonBreakdown = {
  participantId: string;
  /** Their share of the item lines. */
  items: number;
  tax: number;
  tip: number;
  /** items + tax + tip. */
  total: number;
  /** Which items they were on, for the receipt-style summary. */
  lines: { itemId: string; label: string; amount: number; weight: number; of: number }[];
};

export type ItemizedSplit = {
  people: PersonBreakdown[];
  /** Item cents nobody was assigned to, in dollars. Blocks saving when > 0. */
  unassigned: number;
  /** Items with no one on them, for the "3 items need someone" nudge. */
  unassignedItemIds: string[];
  /** Sum of every person's total. Equals the receipt total when nothing is unassigned. */
  allocated: number;
};

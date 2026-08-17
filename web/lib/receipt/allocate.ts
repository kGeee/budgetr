/**
 * Itemized split arithmetic: who ate what → what each person owes.
 *
 * The rule the whole file exists to guarantee: **every cent on the receipt lands
 * on exactly one person.** Splitting three ways is the canonical way to lose a
 * penny, and a bill splitter that's a cent off is a bill splitter people stop
 * trusting. So each stage allocates whole cents with the largest-remainder
 * method and the stages chain, rather than rounding independently and hoping.
 *
 * Tax and tip are prorated by each person's share of the items they were
 * actually on — the fair reading, and the one people expect: order the $48 ramen
 * and you carry more of the tax than the person who only shared the $13 plate.
 */

import { allocateCents } from "@/lib/split-math";
import type { ItemAssignment, ItemizedSplit, ParsedReceipt, PersonBreakdown } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const toCents = (n: number) => Math.round(n * 100);

export type AllocateInput = {
  receipt: ParsedReceipt;
  /** itemId → { participantId → weight }. Missing or all-zero = unassigned. */
  assignments: Record<string, ItemAssignment>;
  /**
   * Everyone in the split, including you (as `ME`). Passed explicitly so a
   * person who ends up on no items still appears — at $0.00 — rather than
   * vanishing from the summary without explanation.
   */
  participantIds: string[];
};

/**
 * Resolve an itemized split.
 *
 * Tax and tip fall back to 0 when the receipt didn't print them, so a scan that
 * only found line items still produces a usable answer.
 */
export function allocateReceipt({
  receipt,
  assignments,
  participantIds,
}: AllocateInput): ItemizedSplit {
  const ids = [...participantIds];
  const itemCents = new Map<string, number>(ids.map((id) => [id, 0]));
  const lines = new Map<string, PersonBreakdown["lines"]>(ids.map((id) => [id, []]));

  let unassignedCents = 0;
  const unassignedItemIds: string[] = [];

  for (const item of receipt.items) {
    const cents = toCents(item.total);
    const weightsById = assignments[item.id] ?? {};
    // Only weights belonging to current participants count — removing someone
    // from the split must not strand their share on the item.
    const eaters = ids.filter((id) => (weightsById[id] ?? 0) > 0);

    if (eaters.length === 0) {
      unassignedCents += cents;
      unassignedItemIds.push(item.id);
      continue;
    }

    const weights = eaters.map((id) => weightsById[id]);
    const totalWeight = weights.reduce((a, w) => a + w, 0);
    const parts = allocateCents(cents, weights);

    eaters.forEach((id, i) => {
      itemCents.set(id, (itemCents.get(id) ?? 0) + parts[i]);
      lines.get(id)!.push({
        itemId: item.id,
        label: item.label,
        amount: parts[i] / 100,
        weight: weights[i],
        of: totalWeight,
      });
    });
  }

  // Tax and tip ride on the ASSIGNED items only. If some of the bill has no one
  // on it, its share of tax and tip stays unassigned too — otherwise the people
  // who did claim something would silently absorb it.
  const assignedWeights = ids.map((id) => itemCents.get(id) ?? 0);
  const assignedTotal = assignedWeights.reduce((a, w) => a + w, 0);
  const itemsTotalCents = assignedTotal + unassignedCents;

  const proratable = (amount: number | null): number[] => {
    const cents = toCents(amount ?? 0);
    if (cents === 0 || assignedTotal === 0) return ids.map(() => 0);
    // Scale down to the assigned fraction so unassigned items don't get a free
    // ride on tax; the remainder is reported via `unassigned`.
    const share = itemsTotalCents > 0 ? Math.round((cents * assignedTotal) / itemsTotalCents) : cents;
    return allocateCents(share, assignedWeights);
  };

  const taxParts = proratable(receipt.tax);
  const tipParts = proratable(receipt.tip);

  const people: PersonBreakdown[] = ids.map((id, i) => {
    const items = itemCents.get(id) ?? 0;
    return {
      participantId: id,
      items: items / 100,
      tax: taxParts[i] / 100,
      tip: tipParts[i] / 100,
      total: (items + taxParts[i] + tipParts[i]) / 100,
      lines: lines.get(id) ?? [],
    };
  });

  const allocated = round2(people.reduce((a, p) => a + p.total, 0));

  // What's unassigned is the untouched items PLUS the tax/tip that rode on them.
  const taxTipCents = toCents(receipt.tax ?? 0) + toCents(receipt.tip ?? 0);
  const allocatedTaxTip = taxParts.reduce((a, n) => a + n, 0) + tipParts.reduce((a, n) => a + n, 0);

  return {
    people,
    unassigned: round2((unassignedCents + Math.max(0, taxTipCents - allocatedTaxTip)) / 100),
    unassignedItemIds,
    allocated,
  };
}

/**
 * Seed an assignment map that puts everyone on everything, evenly — the sane
 * opening state for a split, and one keystroke from correct for the common case
 * where a table shares most of the food.
 */
export function assignAllEvenly(
  receipt: ParsedReceipt,
  participantIds: string[],
): Record<string, ItemAssignment> {
  const even: ItemAssignment = Object.fromEntries(participantIds.map((id) => [id, 1]));
  return Object.fromEntries(receipt.items.map((it) => [it.id, { ...even }]));
}

/** What the item lines add up to, ignoring anything the receipt printed. */
export function itemsTotal(receipt: ParsedReceipt): number {
  return round2(receipt.items.reduce((a, it) => a + it.total, 0));
}

/**
 * The amount this receipt currently describes: items + tax + tip.
 *
 * Deliberately computed from the lines rather than trusting a printed `total`.
 * Once the user edits a line, adds one, or types a tip, the printed total is
 * stale — and it's the sum of the parts that has to match what was charged.
 */
export function receiptTotal(receipt: ParsedReceipt): number {
  return round2(itemsTotal(receipt) + (receipt.tax ?? 0) + (receipt.tip ?? 0));
}

/**
 * Reconcile a scanned receipt against the amount the card was charged.
 *
 * The two disagree constantly, in both directions, and they mean opposite
 * things:
 *
 *  - **The receipt is short.** You were handed a $60.00 check, tapped 10% on the
 *    terminal, and $66.13 was charged. The tip was never printed. Fold the
 *    difference into tip — the receipt was incomplete and the charge knows more.
 *
 *  - **The receipt is over.** The check already shows a $6.36 tip, but only the
 *    pre-tip $83.64 has been authorised; the tip settles a day or two later.
 *    Here the *receipt* knows more. Your friends owe their share of the full
 *    $90.00 — that is what will land on the statement — so the receipt is left
 *    exactly as printed and the shortfall is reported as a pending charge.
 *
 * The asymmetry is the point: whichever document was written last is the one
 * telling the truth, and for a tip that is the terminal on the way in and the
 * paper on the way out.
 */
export function reconcileToCharge(
  receipt: ParsedReceipt,
  charged: number,
): {
  receipt: ParsedReceipt;
  /** Tip folded in to cover a receipt that came up short of the charge. */
  addedTip: number;
  /** How far the charge still trails the receipt — a tip yet to settle. */
  pendingCharge: number;
} {
  const target = Math.abs(round2(charged));
  const gap = round2(target - receiptTotal(receipt));

  if (Math.abs(gap) < 0.01) return { receipt, addedTip: 0, pendingCharge: 0 };

  if (gap > 0) {
    return {
      receipt: { ...receipt, tip: round2((receipt.tip ?? 0) + gap), total: target },
      addedTip: gap,
      pendingCharge: 0,
    };
  }

  // Charged less than the paper says. Never edit the receipt down — the money is
  // owed whether or not the bank has caught up.
  return { receipt, addedTip: 0, pendingCharge: round2(-gap) };
}

/** How far the receipt is from the charge. Positive = receipt is short. */
export function chargeGap(receipt: ParsedReceipt, charged: number): number {
  return round2(Math.abs(round2(charged)) - receiptTotal(receipt));
}

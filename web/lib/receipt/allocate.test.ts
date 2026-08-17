import { describe, expect, it } from "vitest";
import {
  allocateReceipt,
  assignAllEvenly,
  chargeGap,
  itemsTotal,
  receiptTotal,
  reconcileToCharge,
} from "./allocate";
import { parseReceiptRows } from "./parse";
import { ME } from "./types";

const IPPUDO = parseReceiptRows([
  "AKAMARU MODERN × 2 $48.00",
  "($21.00 ea.)",
  "◆TAMAGO ($6.00)",
  "BUNS MEDLEY $16.00",
  "CHICKEN",
  "CHICKEN",
  "CHICKEN",
  "KARA-AGE AKA $13.00",
  "Purchase Subtotal $77.00",
  "Sales Tax (8.625%) $6.64",
  "Tip $6.36",
  "Total $90.00",
]);

const [AKAMARU, BUNS, KARAAGE] = IPPUDO.items.map((i) => i.id);
const A = ME;
const B = "p_bea";
const C = "p_cal";
const THREE = [A, B, C];

const sum = (ns: number[]) => Math.round(ns.reduce((a, n) => a + n, 0) * 100) / 100;

describe("allocateReceipt — the real dinner: 3 people, $90", () => {
  // Two of us had ramen; the buns and the kara-age went round the table.
  const split = allocateReceipt({
    receipt: IPPUDO,
    assignments: {
      [AKAMARU]: { [A]: 1, [B]: 1 },
      [BUNS]: { [A]: 1, [B]: 1, [C]: 1 },
      [KARAAGE]: { [A]: 1, [B]: 1, [C]: 1 },
    },
    participantIds: THREE,
  });

  const byId = Object.fromEntries(split.people.map((p) => [p.participantId, p]));

  it("splits to exactly the receipt total, no cent lost", () => {
    expect(sum(split.people.map((p) => p.total))).toBe(90);
    expect(split.allocated).toBe(90);
    expect(split.unassigned).toBe(0);
  });

  it("charges the ramen only to the two who ordered it", () => {
    expect(byId[A].lines.find((l) => l.itemId === AKAMARU)?.amount).toBe(24);
    expect(byId[B].lines.find((l) => l.itemId === AKAMARU)?.amount).toBe(24);
    expect(byId[C].lines.find((l) => l.itemId === AKAMARU)).toBeUndefined();
  });

  it("splits the shared plates three ways, distributing the odd cent", () => {
    const buns = THREE.map((id) => byId[id].lines.find((l) => l.itemId === BUNS)!.amount);
    expect(sum(buns)).toBe(16);
    expect(buns.sort()).toEqual([5.33, 5.33, 5.34]);
  });

  it("prorates tax and tip by what each person ate, not evenly", () => {
    // C only shared two plates, so C carries far less tax than A or B.
    expect(byId[C].tax).toBeLessThan(byId[A].tax);
    expect(sum(split.people.map((p) => p.tax))).toBe(6.64);
    expect(sum(split.people.map((p) => p.tip))).toBe(6.36);
  });

  it("produces the per-person totals you would settle up with", () => {
    expect(byId[A].total).toBe(39.37);
    expect(byId[B].total).toBe(39.34);
    expect(byId[C].total).toBe(11.29);
  });
});

describe("allocateReceipt — weights", () => {
  it("charges twice as much to someone who had two of three buns", () => {
    const split = allocateReceipt({
      receipt: IPPUDO,
      assignments: { [BUNS]: { [A]: 2, [B]: 1 } },
      participantIds: [A, B],
    });
    const byId = Object.fromEntries(split.people.map((p) => [p.participantId, p]));
    expect(byId[A].items).toBeCloseTo(10.67, 2);
    expect(byId[B].items).toBeCloseTo(5.33, 2);
    expect(sum([byId[A].items, byId[B].items])).toBe(16);
  });

  it("records the weight and the denominator for the summary line", () => {
    const split = allocateReceipt({
      receipt: IPPUDO,
      assignments: { [BUNS]: { [A]: 2, [B]: 1 } },
      participantIds: [A, B],
    });
    const line = split.people[0].lines[0];
    expect(line).toMatchObject({ weight: 2, of: 3, label: "BUNS MEDLEY" });
  });
});

describe("allocateReceipt — unassigned items", () => {
  const split = allocateReceipt({
    receipt: IPPUDO,
    // Nobody claims the kara-age.
    assignments: {
      [AKAMARU]: { [A]: 1, [B]: 1 },
      [BUNS]: { [A]: 1, [B]: 1 },
    },
    participantIds: [A, B],
  });

  it("flags the orphaned item rather than quietly spreading it", () => {
    expect(split.unassignedItemIds).toEqual([KARAAGE]);
    expect(split.unassigned).toBeGreaterThan(13);
  });

  it("keeps the orphan's tax and tip unassigned too", () => {
    // If tax rode entirely on the assigned items, the two diners would silently
    // pay the missing plate's tax.
    expect(sum(split.people.map((p) => p.tax))).toBeLessThan(6.64);
    expect(sum(split.people.map((p) => p.total)) + split.unassigned).toBeCloseTo(90, 1);
  });
});

describe("allocateReceipt — edges", () => {
  it("keeps a participant who ate nothing, at zero", () => {
    const split = allocateReceipt({
      receipt: IPPUDO,
      assignments: assignAllEvenly(IPPUDO, [A, B]),
      participantIds: [A, B, C],
    });
    const c = split.people.find((p) => p.participantId === C)!;
    expect(c.total).toBe(0);
    expect(c.lines).toEqual([]);
  });

  it("ignores weights for people no longer in the split", () => {
    const split = allocateReceipt({
      receipt: IPPUDO,
      assignments: { [KARAAGE]: { [A]: 1, [C]: 1 } },
      participantIds: [A, B],
    });
    // C is gone, so A carries the whole plate — not half of it with the rest lost.
    expect(split.people.find((p) => p.participantId === A)!.items).toBe(13);
  });

  it("handles a receipt with no tax or tip", () => {
    const plain = parseReceiptRows(["A $10.00", "B $5.00"]);
    const split = allocateReceipt({
      receipt: plain,
      assignments: assignAllEvenly(plain, [A, B]),
      participantIds: [A, B],
    });
    expect(sum(split.people.map((p) => p.total))).toBe(15);
  });

  it("returns zeroes rather than dividing by zero on an empty receipt", () => {
    const empty = parseReceiptRows([]);
    const split = allocateReceipt({ receipt: empty, assignments: {}, participantIds: [A] });
    expect(split.people[0].total).toBe(0);
    expect(split.allocated).toBe(0);
  });

  it("assignAllEvenly puts everyone on every item", () => {
    const a = assignAllEvenly(IPPUDO, THREE);
    expect(Object.keys(a)).toEqual([AKAMARU, BUNS, KARAAGE]);
    expect(a[AKAMARU]).toEqual({ [A]: 1, [B]: 1, [C]: 1 });
  });
});

describe("receiptTotal", () => {
  it("sums the parts rather than trusting the printed total", () => {
    expect(receiptTotal(IPPUDO)).toBe(90);
  });

  it("adds tax to the lines", () => {
    const r = parseReceiptRows(["A $10.00", "Subtotal $10.00", "Sales Tax $1.00"]);
    expect(receiptTotal({ ...r, total: null })).toBe(11);
  });

  it("is just the lines when nothing else was printed", () => {
    expect(receiptTotal(parseReceiptRows(["A $10.00", "B $5.00"]))).toBe(15);
  });
});


describe("reconcileToCharge — the tip that was not on the receipt", () => {
  const printed = parseReceiptRows([
    "PIZZA $40.00",
    "SALAD $15.00",
    "Subtotal $55.00",
    "Sales Tax $5.00",
    "Total $60.00",
  ]);

  it("treats a shortfall as tip added at the terminal", () => {
    // The reported case: receipt says $60.00, card was charged $66.13.
    const { receipt, addedTip, overshoot } = reconcileToCharge(printed, 66.13);
    expect(addedTip).toBe(6.13);
    expect(overshoot).toBe(0);
    expect(receipt.tip).toBe(6.13);
    expect(receiptTotal(receipt)).toBe(66.13);
  });

  it("adds to an existing tip rather than replacing it", () => {
    // $55 items + $5 tax + $2 already-tipped = $62, so only $4.13 is missing.
    const withTip = { ...printed, tip: 2 };
    expect(reconcileToCharge(withTip, 66.13).receipt.tip).toBe(6.13);
    expect(receiptTotal(reconcileToCharge(withTip, 66.13).receipt)).toBe(66.13);
  });

  it("leaves an already-matching receipt alone", () => {
    const { receipt, addedTip } = reconcileToCharge(printed, 60);
    expect(addedTip).toBe(0);
    expect(receipt).toBe(printed);
  });

  it("refuses to invent a negative tip when the charge is lower", () => {
    // Less charged than printed means a discount or a misread. There is no
    // honest default, so it is reported rather than silently absorbed.
    const { receipt, addedTip, overshoot } = reconcileToCharge(printed, 50);
    expect(addedTip).toBe(0);
    expect(overshoot).toBe(10);
    // The receipt is handed back untouched — this one printed a $0 tip line.
    expect(receipt).toBe(printed);
  });

  it("ignores the sign of the charge", () => {
    // Transactions are positive-is-spend, but callers should not have to care.
    expect(reconcileToCharge(printed, -66.13).addedTip).toBe(6.13);
  });

  it("splits the reconciled receipt to exactly the amount charged", () => {
    const { receipt } = reconcileToCharge(printed, 66.13);
    const [a, b] = receipt.items.map((i) => i.id);
    const split = allocateReceipt({
      receipt,
      participantIds: [A, B, C],
      assignments: { [a]: { [A]: 1, [B]: 1 }, [b]: { [C]: 1 } },
    });
    expect(sum(split.people.map((p) => p.total))).toBe(66.13);
    expect(split.unassigned).toBe(0);
  });
});

describe("receiptTotal / itemsTotal / chargeGap", () => {
  const r = parseReceiptRows(["A $10.00", "B $5.00", "Subtotal $15.00", "Total $15.00"]);

  it("computes from the lines, not the printed total", () => {
    // A printed total goes stale the moment a line is edited.
    const edited = { ...r, items: [{ ...r.items[0], total: 20 }, r.items[1]] };
    expect(itemsTotal(edited)).toBe(25);
    expect(receiptTotal(edited)).toBe(25);
  });

  it("includes tax and tip", () => {
    expect(receiptTotal({ ...r, tax: 1.5, tip: 3 })).toBe(19.5);
  });

  it("reports the gap against the charge", () => {
    expect(chargeGap(r, 18)).toBe(3);
    expect(chargeGap(r, 15)).toBe(0);
    expect(chargeGap(r, 12)).toBe(-3);
  });
});

import { describe, expect, it } from "vitest";
import { groupIntoRows, parseReceipt, parseReceiptRows } from "./parse.js";
import type { OcrLine } from "./types.js";

/**
 * The fixture is a real receipt (Ippudo, 16 Aug 2026, $90.00) — the one that
 * prompted the feature. It exercises every shape the parser has to handle:
 * a multi-unit line with a per-unit price, an included paid modifier, an item
 * with three unpriced option lines, a plain item, and a full totals block.
 */
const IPPUDO = [
  "$90.00 #FKWV",
  "Aug 16 2026 at 8:42 PM",
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
];

describe("parseReceiptRows — the Ippudo receipt", () => {
  const r = parseReceiptRows(IPPUDO);

  it("finds exactly the three ordered items", () => {
    expect(r.items.map((i) => i.label)).toEqual([
      "AKAMARU MODERN",
      "BUNS MEDLEY",
      "KARA-AGE AKA",
    ]);
  });

  it("reads the quantity off the line and the unit price off the line below", () => {
    const akamaru = r.items[0]!;
    expect(akamaru.quantity).toBe(2);
    expect(akamaru.unitPrice).toBe(21);
    expect(akamaru.total).toBe(48);
  });

  it("keeps a paid modifier as a modifier, never as its own item", () => {
    // ◆TAMAGO is $6 and is already inside the $48 — adding it would overcount.
    expect(r.items[0]!.modifiers).toEqual([{ label: "◆TAMAGO", price: 6 }]);
    expect(r.items.some((i) => i.label.includes("TAMAGO"))).toBe(false);
  });

  it("attaches unpriced option lines to the item above", () => {
    expect(r.items[1]!.label).toBe("BUNS MEDLEY");
    expect(r.items[1]!.modifiers.map((m) => m.label)).toEqual(["CHICKEN", "CHICKEN", "CHICKEN"]);
  });

  it("reads the totals block, including the tax rate", () => {
    expect(r.subtotal).toBe(77);
    expect(r.tax).toBe(6.64);
    expect(r.tip).toBe(6.36);
    expect(r.total).toBe(90);
    expect(r.taxRatePct).toBe(8.625);
  });

  it("reconciles: the items add up to the printed subtotal", () => {
    expect(r.discrepancy).toBeNull();
    expect(r.items.reduce((a, i) => a + i.total, 0)).toBe(77);
  });

  it("does not mistake the header total for an item", () => {
    // "$90.00 #FKWV" leads the receipt; it must not become a $90 line item.
    expect(r.items.every((i) => i.total !== 90)).toBe(true);
  });

  it("drops the headline total even when OCR puts the price last", () => {
    // Same receipt, but the check number lands left of the amount — which is
    // what happens when the photo is taken at a slight angle.
    const flipped = parseReceiptRows(["#FKWV $90.00", ...IPPUDO.slice(2)]);
    expect(flipped.items.map((i) => i.label)).toEqual([
      "AKAMARU MODERN",
      "BUNS MEDLEY",
      "KARA-AGE AKA",
    ]);
    expect(flipped.discrepancy).toBeNull();
  });

  it("keeps a legitimate item that happens to cost the whole bill", () => {
    // One $40 thing, nothing else: dropping it would empty the receipt.
    const single = parseReceiptRows(["OMAKASE $40.00", "Subtotal $40.00", "Total $40.00"]);
    expect(single.items).toHaveLength(1);
  });
});

describe("parseReceiptRows — edge cases", () => {
  it("reports a discrepancy instead of silently splitting a bad parse", () => {
    const r = parseReceiptRows(["BURGER $10.00", "FRIES $5.00", "Subtotal $20.00"]);
    expect(r.discrepancy).toEqual({ itemsTotal: 15, subtotal: 20, difference: -5 });
  });

  it("infers a missing tip from the other three figures", () => {
    const r = parseReceiptRows(["THING $50.00", "Subtotal $50.00", "Tax $4.00", "Total $60.00"]);
    expect(r.tip).toBe(6);
  });

  it("infers a missing total", () => {
    const r = parseReceiptRows(["THING $50.00", "Subtotal $50.00", "Tax $4.00", "Tip $6.00"]);
    expect(r.total).toBe(60);
  });

  it("prefers Subtotal over Total when both words appear", () => {
    const r = parseReceiptRows(["A $1.00", "Purchase Subtotal $1.00", "Total $1.10"]);
    expect(r.subtotal).toBe(1);
    expect(r.total).toBe(1.1);
  });

  it("handles a leading quantity", () => {
    const r = parseReceiptRows(["3 × TACO $9.00"]);
    expect(r.items[0]).toMatchObject({ label: "TACO", quantity: 3, total: 9 });
  });

  it("ignores payment noise below the totals", () => {
    const r = parseReceiptRows([
      "THING $5.00",
      "Total $5.00",
      "VISA ****1234 $5.00",
      "Thank you!",
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.unparsed).toEqual([]);
  });

  it("does not read a bare quantity as a price", () => {
    // No trailing 2-decimal money token, so this is not a priced line at all.
    const r = parseReceiptRows(["SODA × 2"]);
    expect(r.items).toHaveLength(0);
  });

  it("survives a receipt with no totals block at all", () => {
    const r = parseReceiptRows(["A $3.00", "B $4.00"]);
    expect(r.items).toHaveLength(2);
    expect(r.subtotal).toBeNull();
    expect(r.discrepancy).toBeNull();
  });

  it("returns empty for an empty scan rather than throwing", () => {
    expect(parseReceiptRows([]).items).toEqual([]);
    expect(parseReceipt([]).items).toEqual([]);
  });
});

describe("groupIntoRows", () => {
  const line = (text: string, x: number, y: number, w = 0.3, h = 0.03): OcrLine => ({
    text,
    x,
    y,
    w,
    h,
  });

  it("pairs a left description with its right-aligned price", () => {
    expect(
      groupIntoRows([
        line("KARA-AGE AKA", 0.05, 0.6),
        line("$13.00", 0.8, 0.601),
        line("Total", 0.05, 0.7),
        line("$90.00", 0.8, 0.7),
      ]),
    ).toEqual(["KARA-AGE AKA $13.00", "Total $90.00"]);
  });

  it("keeps adjacent lines apart when they do not overlap vertically", () => {
    expect(groupIntoRows([line("CHICKEN", 0.05, 0.5), line("CHICKEN", 0.05, 0.55)])).toEqual([
      "CHICKEN",
      "CHICKEN",
    ]);
  });

  it("tolerates a slightly rotated photo", () => {
    // The price sits 40% of a line-height lower than its description.
    expect(
      groupIntoRows([line("BUNS MEDLEY", 0.05, 0.4), line("$16.00", 0.8, 0.412)]),
    ).toEqual(["BUNS MEDLEY $16.00"]);
  });

  it("orders rows top-to-bottom regardless of input order", () => {
    expect(
      groupIntoRows([line("second", 0.05, 0.5), line("first", 0.05, 0.2)]),
    ).toEqual(["first", "second"]);
  });

  it("parses end-to-end from boxes", () => {
    const r = parseReceipt([
      line("BUNS MEDLEY", 0.05, 0.4),
      line("$16.00", 0.8, 0.401),
      line("CHICKEN", 0.05, 0.45),
      line("Subtotal", 0.05, 0.6),
      line("$16.00", 0.8, 0.6),
    ]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.modifiers.map((m) => m.label)).toEqual(["CHICKEN"]);
    expect(r.subtotal).toBe(16);
  });
});

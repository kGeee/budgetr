import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseReceiptRows } from "@budgetr/core";
import { ME } from "@budgetr/core";

// The editor imports a "use server" module for scanning; stub it so this test
// renders markup instead of dragging the database in.
vi.mock("@/lib/actions-receipt", () => ({ scanReceipt: vi.fn() }));

const { ReceiptSplit } = await import("./receipt-split");

const RECEIPT = parseReceiptRows([
  "PIZZA $40.00",
  "SALAD $15.00",
  "Purchase Subtotal $55.00",
  "Sales Tax $5.00",
  "Total $60.00",
]);

const PEOPLE = [
  { id: ME, name: "You" },
  { id: "p_bea", name: "Bea" },
];

function render(overrides: Partial<Parameters<typeof ReceiptSplit>[0]> = {}) {
  return renderToStaticMarkup(
    <ReceiptSplit
      transactionId="t1"
      currency="USD"
      charged={66.13}
      participants={PEOPLE}
      scanAvailable
      receipt={RECEIPT}
      assignments={{ [RECEIPT.items[0].id]: { [ME]: 1 } }}
      onReceipt={() => {}}
      onAssignments={() => {}}
      {...overrides}
    />,
  );
}

/**
 * These guard the two things that broke in real use, both of which are visible
 * in the markup: a line name you can't type into, and tax/tip with no control.
 */
describe("ReceiptSplit — the editor's controls exist", () => {
  const html = render();

  it("renders every line name as an editable input, not static text", () => {
    // The regression: the label became the brush's tap target, so it stopped
    // being an input and the line could no longer be renamed.
    expect(html).toContain('aria-label="Line name"');
    expect(html).toContain('value="PIZZA"');
    expect(html).toContain('value="SALAD"');
    expect((html.match(/aria-label="Line name"/g) ?? []).length).toBe(RECEIPT.items.length);
  });

  it("gives tax and tip their own inputs", () => {
    expect(html).toContain("Tax");
    expect(html).toContain("Tip");
    // Tax parsed at $5.00 and the $6.13 shortfall is the caller's to reconcile;
    // both must be present as editable values, not baked into a total.
    expect(html).toContain('value="5"');
  });

  it("offers tip percentage presets computed off the item subtotal", () => {
    for (const label of [">15%<", ">18%<", ">20%<", ">22%<"]) {
      expect(html).toContain(label);
    }
  });

  it("shows items, receipt total and what was actually charged", () => {
    expect(html).toContain("Items");
    expect(html).toContain("Receipt total");
    expect(html).toContain("Charged");
    expect(html).toContain("$66.13");
  });

  it("surfaces the unreconciled gap with one-tap fixes", () => {
    // $55 items + $5 tax = $60 against a $66.13 charge.
    expect(html).toContain("Add as tip");
    expect(html).toContain("Add as tax");
  });

  it("keeps the price editable per line", () => {
    expect(html).toContain('value="40"');
    expect(html).toContain('value="15"');
  });

  it("names the brush and the bulk actions", () => {
    expect(html).toContain("Tap lines to assign");
    expect(html).toContain("Everyone on everything");
    expect(html).toContain("Clear");
    expect(html).toContain("1/2 assigned");
  });

  it("flags the line nobody is on", () => {
    expect(html).toContain("line needs someone");
  });

  it("renders the portions stepper when a line is opened for uneven shares", () => {
    // The scales button is useless without the panel it toggles — and a careless
    // edit once left exactly that, a control wired to nothing.
    const withPortions = renderToStaticMarkup(
      <ReceiptSplit
        transactionId="t1"
        currency="USD"
        charged={66.13}
        participants={PEOPLE}
        scanAvailable
        receipt={RECEIPT}
        assignments={{ [RECEIPT.items[0].id]: { [ME]: 2, p_bea: 1 } }}
        onReceipt={() => {}}
        onAssignments={() => {}}
      />,
    );
    // The weight shows on the initials chip even before the panel is opened.
    expect(withPortions).toContain("×2");
    expect(withPortions).toContain('title="Uneven portions"');
  });
});

/**
 * The case that showed up in real use: an $90.00 check with a $6.36 tip line,
 * authorised at $83.64 because the tip settles a day later. The receipt is
 * right and the bank is behind, so this must read as information, not an error.
 */
describe("ReceiptSplit — a tip that has not posted yet", () => {
  const TIPPED = parseReceiptRows([
    "RAMEN $77.00",
    "Purchase Subtotal $77.00",
    "Sales Tax $6.64",
    "Tip $6.36",
    "Total $90.00",
  ]);

  const html = renderToStaticMarkup(
    <ReceiptSplit
      transactionId="t1"
      currency="USD"
      charged={83.64}
      participants={PEOPLE}
      scanAvailable
      receipt={TIPPED}
      assignments={{ [TIPPED.items[0].id]: { [ME]: 1, p_bea: 1 } }}
      onReceipt={() => {}}
      onAssignments={() => {}}
    />,
  );

  it("says the shortfall is pending rather than calling it wrong", () => {
    expect(html).toContain("hasn’t posted yet");
    expect(html).toContain("a tip still settling");
  });

  it("splits the receipt, not the smaller charge", () => {
    expect(html).toContain("Splitting the $90.00 receipt");
  });

  it("offers matching the charge as a choice, not a demand", () => {
    expect(html).toContain("Split $83.64 instead");
  });

  it("never offers to add the difference as tip in this direction", () => {
    // "Add as tip" belongs to the opposite case — a receipt short of the charge.
    expect(html).not.toContain("Add as tip");
    expect(html).not.toContain("isn’t on the receipt");
  });
});

describe("ReceiptSplit — the empty state", () => {
  it("offers scanning and manual entry, and promises nothing is uploaded", () => {
    const html = render({ receipt: null });
    expect(html).toContain("Scan receipt");
    expect(html).toContain("Enter items by hand");
    expect(html).toContain("nothing is uploaded");
  });

  it("drops the scan button where on-device recognition is unavailable", () => {
    const html = render({ receipt: null, scanAvailable: false });
    expect(html).not.toContain("Scan receipt");
    expect(html).toContain("Enter items by hand");
  });
});

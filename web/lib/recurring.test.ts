import { describe, it, expect } from "vitest";
import {
  daysLate,
  monthlyCommitment,
  monthlyEquivalent,
  splitByDue,
  streamLabel,
} from "@/lib/recurring";
import type { RecurringRow } from "@/lib/queries";

const stream = (over: Partial<RecurringRow> = {}): RecurringRow => ({
  id: "s1",
  direction: "outflow",
  description: null,
  merchantName: "Splice",
  userLabel: null,
  category: null,
  frequency: "MONTHLY",
  averageAmount: 19.99,
  lastAmount: 19.99,
  lastDate: "2026-07-12",
  predictedNextDate: "2026-08-12",
  currency: "USD",
  accountName: "CREDIT CARD",
  status: "MATURE",
  ...over,
});

describe("monthlyEquivalent", () => {
  it("uses 52/12 for weekly, not 4", () => {
    // $20 weekly is $86.67 a month. Treating it as 4 payments loses a
    // fortnight's worth over a year.
    expect(monthlyEquivalent({ frequency: "WEEKLY", averageAmount: 20 })).toBeCloseTo(86.67, 2);
    expect(monthlyEquivalent({ frequency: "BIWEEKLY", averageAmount: 20 })).toBeCloseTo(43.33, 2);
  });

  it("normalises the other known frequencies", () => {
    expect(monthlyEquivalent({ frequency: "MONTHLY", averageAmount: 19.99 })).toBeCloseTo(19.99);
    expect(monthlyEquivalent({ frequency: "SEMI_MONTHLY", averageAmount: 50 })).toBe(100);
    expect(monthlyEquivalent({ frequency: "ANNUALLY", averageAmount: 240 })).toBe(20);
  });

  it("refuses to invent a figure for an irregular stream", () => {
    // Coercing UNKNOWN to a monthly number would quietly inflate the headline.
    expect(monthlyEquivalent({ frequency: "UNKNOWN", averageAmount: 100 })).toBeNull();
    expect(monthlyEquivalent({ frequency: null, averageAmount: 100 })).toBeNull();
  });

  it("takes the magnitude, so inflows and outflows both read positive", () => {
    expect(monthlyEquivalent({ frequency: "MONTHLY", averageAmount: -19.99 })).toBeCloseTo(19.99);
  });
});

describe("monthlyCommitment", () => {
  it("sums the normalisable streams and counts the rest separately", () => {
    const { total, irregular } = monthlyCommitment([
      stream({ frequency: "MONTHLY", averageAmount: 100 }),
      stream({ frequency: "ANNUALLY", averageAmount: 240 }),
      stream({ frequency: "UNKNOWN", averageAmount: 999 }),
    ]);
    expect(total).toBe(120);
    expect(irregular).toBe(1);
  });
});

describe("splitByDue", () => {
  const TODAY = "2026-08-10";

  it("separates a passed prediction from an upcoming one", () => {
    const s = splitByDue(
      [
        stream({ id: "late", predictedNextDate: "2026-07-12" }),
        stream({ id: "soon", predictedNextDate: "2026-08-14" }),
        stream({ id: "later", predictedNextDate: "2026-09-06" }),
      ],
      TODAY,
    );
    expect(s.overdue.map((r) => r.id)).toEqual(["late"]);
    expect(s.soon.map((r) => r.id)).toEqual(["soon"]);
    expect(s.later.map((r) => r.id)).toEqual(["later"]);
  });

  it("counts today as due, not overdue", () => {
    const s = splitByDue([stream({ predictedNextDate: TODAY })], TODAY);
    expect(s.overdue).toHaveLength(0);
    expect(s.soon).toHaveLength(1);
  });

  it("respects the soon horizon boundary", () => {
    const s = splitByDue(
      [
        stream({ id: "edge", predictedNextDate: "2026-08-17" }),
        stream({ id: "past-edge", predictedNextDate: "2026-08-18" }),
      ],
      TODAY,
      7,
    );
    expect(s.soon.map((r) => r.id)).toEqual(["edge"]);
    expect(s.later.map((r) => r.id)).toEqual(["past-edge"]);
  });

  it("puts a stream with no prediction in later rather than overdue", () => {
    const s = splitByDue([stream({ predictedNextDate: null })], TODAY);
    expect(s.overdue).toHaveLength(0);
    expect(s.later).toHaveLength(1);
  });

  it("sorts each bucket by date", () => {
    const s = splitByDue(
      [
        stream({ id: "b", predictedNextDate: "2026-07-22" }),
        stream({ id: "a", predictedNextDate: "2026-07-12" }),
      ],
      TODAY,
    );
    expect(s.overdue.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("daysLate", () => {
  it("counts whole days past, and zero for anything not past", () => {
    expect(daysLate("2026-07-12", "2026-08-10")).toBe(29);
    expect(daysLate("2026-08-10", "2026-08-10")).toBe(0);
    expect(daysLate("2026-09-01", "2026-08-10")).toBe(0);
    expect(daysLate(null, "2026-08-10")).toBe(0);
  });
});

describe("streamLabel", () => {
  it("prefers a user label over everything", () => {
    expect(
      streamLabel({ userLabel: "Mortgage", merchantName: "Splice", description: "x" }),
    ).toEqual({ name: "Mortgage", needsName: false });
  });

  it("falls back to the merchant, which needs no naming", () => {
    expect(streamLabel({ merchantName: "Splice", description: null })).toEqual({
      name: "Splice",
      needsName: false,
    });
  });

  it("flags a descriptor-only stream as needing a name but still shows it", () => {
    // The two largest streams in this ledger have no merchant. Showing
    // "Unknown" invites nothing; showing the descriptor plus a prompt is
    // actionable.
    // "ACH" survives title-casing as an acronym; "DEBIT" doesn't.
    expect(streamLabel({ merchantName: null, description: "ACH DEBIT" })).toEqual({
      name: "ACH Debit",
      needsName: true,
    });

    // And the descriptor is cleaned on the way out — leaving it raw put the
    // account holder's name in the largest figure on the page.
    const ach = streamLabel({
      merchantName: null,
      description:
        "AMERICAN EXPRESS DES:ACH PMT ID:A4948 INDN:KEVIN GEORGE CO ID:XXXXX33497 WEB",
    });
    expect(ach).toEqual({ name: "American Express", needsName: true });
    expect(streamLabel({ merchantName: null, description: null })).toEqual({
      name: "Unnamed stream",
      needsName: true,
    });
  });

  it("treats whitespace as absent", () => {
    expect(streamLabel({ userLabel: "  ", merchantName: "Splice", description: null }).name).toBe(
      "Splice",
    );
  });
});

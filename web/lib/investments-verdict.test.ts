import { describe, expect, it } from "vitest";
import {
  allocationVerdict,
  marginVerdict,
  optionsBookVerdict,
  realizedVerdict,
  scanVerdict,
  wheelVerdict,
} from "./investments-verdict";

describe("allocationVerdict", () => {
  const unassigned = "Unassigned";

  it("says nothing for an empty book", () => {
    expect(allocationVerdict({ slices: [], total: 0, unassigned })).toBeNull();
    expect(allocationVerdict({ slices: [{ sector: "Tech", value: 0 }], total: 100, unassigned })).toBeNull();
  });

  it("names the largest sector and its share regardless of input order", () => {
    const v = allocationVerdict({
      slices: [
        { sector: "Energy", value: 320 },
        { sector: "Tech", value: 380 },
        { sector: "Health", value: 300 },
      ],
      total: 1000,
      unassigned,
    });
    expect(v).toEqual({
      tone: "default",
      lead: "Tech is the largest sector at",
      share: "38%",
      tail: "of the book, across 3 sectors.",
    });
  });

  it("turns brass once one sector is half the book", () => {
    const v = allocationVerdict({
      slices: [
        { sector: "Tech", value: 600 },
        { sector: "Energy", value: 400 },
      ],
      total: 1000,
      unassigned,
    });
    expect(v).toMatchObject({ tone: "brass", share: "60%", tail: "of the book, across 2 sectors." });
  });

  it("calls out untagged money when it leads", () => {
    const v = allocationVerdict({
      slices: [
        { sector: "Unassigned", value: 700 },
        { sector: "Tech", value: 300 },
      ],
      total: 1000,
      unassigned,
    });
    expect(v).toMatchObject({ tone: "brass", share: "70%", tail: "of the book, has no sector assigned yet." });
  });

  it("does not count the unassigned slice as a sector", () => {
    const v = allocationVerdict({
      slices: [
        { sector: "Tech", value: 600 },
        { sector: "Unassigned", value: 400 },
      ],
      total: 1000,
      unassigned,
    });
    expect(v!.tail).toBe("of the book, across 1 sector.");
  });

  it("handles a single-sector book", () => {
    const v = allocationVerdict({ slices: [{ sector: "Tech", value: 50 }], total: 50, unassigned });
    expect(v).toMatchObject({ lead: "Tech is", share: "100%" });
  });
});

describe("realizedVerdict", () => {
  it("says nothing without closed lots", () => {
    expect(realizedVerdict({ total: 0, count: 0 })).toBeNull();
  });

  it("reports a gain", () => {
    expect(realizedVerdict({ total: 1250.5, count: 3 })).toEqual({
      tone: "jade",
      lead: "Sales realized a net gain of",
      amount: 1250.5,
      tail: "across 3 closed lots.",
    });
  });

  it("reports a loss as a positive amount", () => {
    const v = realizedVerdict({ total: -40, count: 1 });
    expect(v).toMatchObject({ tone: "coral", amount: 40, tail: "across 1 closed lot." });
  });

  it("has no figure at break-even", () => {
    expect(realizedVerdict({ total: 0.001, count: 2 })).toMatchObject({ amount: null, lead: "Sales broke even" });
  });
});

describe("optionsBookVerdict", () => {
  it("is calm when nothing expires this week", () => {
    expect(optionsBookVerdict({ soon: 0, soonItm: 0, ifAssigned: 0 })).toEqual({
      tone: "jade",
      expiry: "Nothing expires in the next seven days.",
      assigned: null,
    });
  });

  it("flags near expiries that are out of the money", () => {
    const v = optionsBookVerdict({ soon: 2, soonItm: 0, ifAssigned: 9500 });
    expect(v).toEqual({
      tone: "brass",
      expiry: "2 legs expire within seven days, none in the money.",
      assigned: 9500,
    });
  });

  it("warns when some are in the money", () => {
    expect(optionsBookVerdict({ soon: 3, soonItm: 1, ifAssigned: 0 }).expiry).toBe(
      "3 legs expire within seven days — 1 in the money.",
    );
    expect(optionsBookVerdict({ soon: 3, soonItm: 3, ifAssigned: 0 })).toMatchObject({
      tone: "coral",
      expiry: "3 legs expire within seven days — all of them in the money.",
    });
    expect(optionsBookVerdict({ soon: 1, soonItm: 1, ifAssigned: 0 }).expiry).toBe(
      "1 leg expires within seven days — and it is in the money.",
    );
  });
});

describe("wheelVerdict", () => {
  it("reports a positive month", () => {
    expect(wheelVerdict({ netThisMonth: 310, openContracts: 2, uncoveredCalls: 0 })).toEqual({
      tone: "jade",
      lead: "This month added",
      amount: 310,
      tail: "with 2 short contracts still open.",
    });
  });

  it("reports a negative month as a positive amount", () => {
    const v = wheelVerdict({ netThisMonth: -75, openContracts: 0, uncoveredCalls: 0 });
    expect(v).toMatchObject({
      tone: "coral",
      lead: "This month gave back",
      amount: 75,
      tail: "with no short contracts open.",
    });
  });

  it("has no figure in a month with no premium", () => {
    expect(wheelVerdict({ netThisMonth: 0, openContracts: 1, uncoveredCalls: 0 })).toMatchObject({
      tone: "default",
      amount: null,
      tail: "with 1 short contract still open.",
    });
  });

  it("turns coral on an uncovered call even in a good month", () => {
    const v = wheelVerdict({ netThisMonth: 500, openContracts: 3, uncoveredCalls: 1 });
    expect(v.tone).toBe("coral");
    expect(v.tail).toBe("with 3 short contracts still open — 1 call of them uncovered.");
  });
});

describe("scanVerdict", () => {
  it("names the top candidate", () => {
    expect(
      scanVerdict({ universe: 40, best: { ticker: "MU", strike: "95", annualizedPct: 31.6, score: 81 } }),
    ).toEqual({
      tone: "jade",
      lead: "The best-ranked put is",
      pick: "MU 95p",
      tail: "at 32% annualized, scoring 81.",
    });
  });

  it("says so when nothing ranked", () => {
    const v = scanVerdict({ universe: 1, best: undefined });
    expect(v.pick).toBeNull();
    expect(v.lead).toBe("None of the 1 symbol scanned has a put inside the window.");
  });
});

describe("marginVerdict", () => {
  it("says nothing without revenue", () => {
    expect(marginVerdict({ revenue: 0, netIncome: 5 })).toBeNull();
  });

  it("reports what was kept", () => {
    expect(marginVerdict({ revenue: 1000, netIncome: 253 })).toEqual({
      tone: "jade",
      lead: "kept",
      margin: "25.3%",
      tail: "of revenue as net income.",
    });
  });

  it("reports a loss unsigned", () => {
    expect(marginVerdict({ revenue: 1000, netIncome: -120 })).toMatchObject({
      tone: "coral",
      lead: "lost",
      margin: "12.0%",
    });
  });
});

import { describe, expect, it } from "vitest";
import { forwardFilledTotals } from "./snapshot-series";

describe("forwardFilledTotals", () => {
  it("carries an account's balance across days its item didn't sync", () => {
    const rows = [
      { accountId: "brokerage", date: "2026-11-01", balance: 100 },
      { accountId: "savings", date: "2026-11-01", balance: 10 },
      { accountId: "brokerage", date: "2026-11-02", balance: 101 }, // savings missing
      { accountId: "brokerage", date: "2026-11-03", balance: 102 },
      { accountId: "savings", date: "2026-11-03", balance: 11 },
    ];
    expect(forwardFilledTotals(rows)).toEqual([
      { date: "2026-11-01", total: 110 },
      { date: "2026-11-02", total: 111 },
      { date: "2026-11-03", total: 113 },
    ]);
  });

  it("adds an account from its first snapshot and drops it after its last", () => {
    const rows = [
      { accountId: "a", date: "2026-11-01", balance: 50 },
      { accountId: "closed", date: "2026-11-01", balance: 5 },
      { accountId: "a", date: "2026-11-02", balance: 50 },
      { accountId: "new", date: "2026-11-02", balance: 7 },
      { accountId: "a", date: "2026-11-03", balance: 50 },
      { accountId: "new", date: "2026-11-03", balance: 7 },
    ];
    expect(forwardFilledTotals(rows).map((p) => p.total)).toEqual([55, 57, 57]);
  });
});

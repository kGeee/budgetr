import { describe, it, expect } from "vitest";
import { tradeFingerprint, type FingerprintInput } from "@/lib/import/fingerprint";

const base: FingerprintInput = {
  accountId: "acct-1",
  date: "2021-05-03",
  ticker: "AAPL",
  quantity: 10,
  amount: 2000,
  side: "buy",
};

describe("tradeFingerprint", () => {
  it("is deterministic — identical input reproduces the same id (idempotent re-import)", () => {
    expect(tradeFingerprint(base)).toBe(tradeFingerprint({ ...base }));
  });

  it("always carries the imp_ prefix so it can't collide with Plaid ids", () => {
    expect(tradeFingerprint(base)).toMatch(/^imp_/);
    expect(tradeFingerprint({ ...base, fitid: "X1" })).toMatch(/^imp_/);
  });

  it("changes when any economic field changes", () => {
    const id = tradeFingerprint(base);
    expect(tradeFingerprint({ ...base, quantity: 11 })).not.toBe(id);
    expect(tradeFingerprint({ ...base, amount: 2001 })).not.toBe(id);
    expect(tradeFingerprint({ ...base, side: "sell" })).not.toBe(id);
    expect(tradeFingerprint({ ...base, date: "2021-05-04" })).not.toBe(id);
    expect(tradeFingerprint({ ...base, ticker: "MSFT" })).not.toBe(id);
    expect(tradeFingerprint({ ...base, accountId: "acct-2" })).not.toBe(id);
  });

  it("treats 10 and 10.0 as the same quantity", () => {
    expect(tradeFingerprint({ ...base, quantity: 10 })).toBe(tradeFingerprint({ ...base, quantity: 10.0 }));
  });

  it("uses FITID as the key when present, scoped to the account", () => {
    const a = tradeFingerprint({ ...base, fitid: "BROKER-99" });
    // Same FITID + same account → same id even if other fields differ (broker id is authoritative).
    expect(tradeFingerprint({ ...base, fitid: "BROKER-99", amount: 9999 })).toBe(a);
    // Same FITID, different account → different id.
    expect(tradeFingerprint({ ...base, fitid: "BROKER-99", accountId: "acct-2" })).not.toBe(a);
    // Different FITID → different id.
    expect(tradeFingerprint({ ...base, fitid: "BROKER-100" })).not.toBe(a);
  });

  it("disambiguates genuinely-identical same-day CSV trades by occurrence index", () => {
    const first = tradeFingerprint({ ...base, seq: 0 });
    const second = tradeFingerprint({ ...base, seq: 1 });
    expect(first).not.toBe(second);
    // …but the same index re-imports identically.
    expect(tradeFingerprint({ ...base, seq: 1 })).toBe(second);
  });
});

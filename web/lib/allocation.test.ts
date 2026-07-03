import { describe, it, expect } from "vitest";
import {
  assetClassFor,
  buildAllocation,
  detectConcentration,
  targetKeyFor,
  parseTargetKey,
  type AllocHolding,
} from "@/lib/allocation";

const h = (ticker: string | null, securityType: string | null): AllocHolding => ({
  ticker,
  securityType,
  sectorKey: ticker ? `sym:${ticker}` : "man:x",
});

describe("assetClassFor", () => {
  it("classifies an OCC option leg as options regardless of Plaid type", () => {
    expect(assetClassFor(h("LRCX260821C00430000", "equity"))).toBe("options");
  });

  it("infers class from security type", () => {
    expect(assetClassFor(h("BTC", "cryptocurrency"))).toBe("crypto");
    expect(assetClassFor(h("BND", "fixed income"))).toBe("bonds");
    expect(assetClassFor(h("VMFXX", "money market"))).toBe("cash");
    expect(assetClassFor(h("AAPL", "equity"))).toBe("stocks");
    expect(assetClassFor(h("XYZ", null))).toBe("stocks"); // unknown → stocks
  });

  it("lets a user override win over inference", () => {
    expect(assetClassFor(h("AAPL", "equity"), "bonds")).toBe("bonds");
    expect(assetClassFor(h("AAPL", "equity"), "not-a-class")).toBe("stocks"); // invalid override ignored
  });
});

describe("buildAllocation", () => {
  it("value-weights into buckets, ranked largest first", () => {
    const items = [
      { cls: "stocks", v: 100 },
      { cls: "bonds", v: 300 },
      { cls: "stocks", v: 50 },
    ];
    const slices = buildAllocation(
      items,
      (i) => ({ key: i.cls, label: i.cls }),
      (i) => i.v,
    );
    expect(slices.map((s) => [s.key, s.value, s.count])).toEqual([
      ["bonds", 300, 1],
      ["stocks", 150, 2],
    ]);
  });
});

describe("detectConcentration", () => {
  it("flags positions at/over the threshold, aggregating by key", () => {
    const items = [
      { key: "NVDA", label: "NVDA", value: 20 },
      { key: "NVDA", label: "NVDA", value: 12 }, // 32 total
      { key: "AAPL", label: "AAPL", value: 10 },
    ];
    const warnings = detectConcentration(items, 100, 25);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].key).toBe("NVDA");
    expect(warnings[0].pct).toBe(32);
  });

  it("returns nothing for a zero/negative portfolio total", () => {
    expect(detectConcentration([{ key: "X", label: "X", value: 5 }], 0)).toEqual([]);
  });
});

describe("target keys", () => {
  it("round-trips a namespaced key, upper-casing tickers", () => {
    expect(targetKeyFor("ticker", "aapl")).toBe("ticker:AAPL");
    expect(parseTargetKey("ticker:AAPL")).toEqual({ dimension: "ticker", name: "AAPL" });
    expect(parseTargetKey("class:stocks")).toEqual({ dimension: "class", name: "stocks" });
  });
});

import { describe, expect, it } from "vitest";
import { classifyHolding, isCashLike, KIND_ORDER } from "./classify";

const h = (ticker: string | null, securityType: string | null, fromWallet = false) => ({
  ticker,
  securityType,
  fromWallet,
});

describe("classifyHolding", () => {
  it("reads the real portfolio's security types", () => {
    expect(classifyHolding(h("SPY", "etf"))).toBe("fund");
    expect(classifyHolding(h("MEILRG", "mutual fund"))).toBe("fund");
    expect(classifyHolding(h("ILLBDF", "fixed income"))).toBe("fund");
    expect(classifyHolding(h("COST", "equity"))).toBe("stock");
    expect(classifyHolding(h("BTC-USD", "crypto"))).toBe("crypto");
  });

  it("treats brokerage cash as cash, not a position", () => {
    // Three of these on the real account, worth $17.5k between them — they were
    // rendering with a Qty, a $1.00 price and an em-dash P&L.
    expect(classifyHolding(h("CUR:USD", null))).toBe("cash");
    expect(classifyHolding(h("BCDXX", "cash"))).toBe("cash");
    expect(isCashLike(h("CUR:USD", "equity"))).toBe(true);
  });

  it("classifies option legs by their OCC symbol, before anything else", () => {
    expect(classifyHolding(h("MU270115P00700000", "derivative"))).toBe("option");
    expect(classifyHolding(h("AAPL260918C00310000", null))).toBe("option");
    // An OCC symbol wins even if the type says otherwise.
    expect(classifyHolding(h("BB280121C00007000", "equity"))).toBe("option");
  });

  it("treats wallet-imported holdings as crypto whatever their type says", () => {
    expect(classifyHolding(h("SOL-USD", null, true))).toBe("crypto");
    expect(classifyHolding(h("HYPE32196-USD", null, true))).toBe("crypto");
  });

  it("falls back to the -USD pair convention for untyped coins", () => {
    expect(classifyHolding(h("ETH-USD", null))).toBe("crypto");
  });

  it("returns other rather than guessing", () => {
    expect(classifyHolding(h("WLINEQ", null))).toBe("other");
    expect(classifyHolding(h(null, null))).toBe("other");
  });

  it("orders cash last — it is not a bet", () => {
    expect(KIND_ORDER.indexOf("cash")).toBeGreaterThan(KIND_ORDER.indexOf("stock"));
    expect(KIND_ORDER[KIND_ORDER.length - 1]).toBe("other");
  });
});

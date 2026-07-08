import { describe, it, expect } from "vitest";
import {
  parseOccSymbol,
  formatStrike,
  daysToExpiry,
  riskLevel,
  isItmCall,
  isItmPut,
  optionRiskFlag,
  classifyOptionLegs,
} from "@/lib/options";

describe("parseOccSymbol", () => {
  it("parses a well-formed OCC symbol", () => {
    expect(parseOccSymbol("LRCX260821C00430000")).toEqual({
      occ: "LRCX260821C00430000",
      underlying: "LRCX",
      expiry: "2026-08-21",
      right: "call",
      strike: 430,
    });
  });

  it("parses a put with a fractional strike", () => {
    const p = parseOccSymbol("SPY251219P00007500");
    expect(p?.right).toBe("put");
    expect(p?.strike).toBe(7.5);
  });

  it("returns null for equities / junk / nullish input", () => {
    expect(parseOccSymbol("AAPL")).toBeNull();
    expect(parseOccSymbol("")).toBeNull();
    expect(parseOccSymbol(null)).toBeNull();
  });
});

describe("formatStrike", () => {
  it("drops cents for whole strikes, keeps them otherwise", () => {
    expect(formatStrike(430)).toBe("$430");
    expect(formatStrike(7.5)).toBe("$7.50");
  });
});

describe("daysToExpiry + riskLevel", () => {
  it("counts whole days to expiry in UTC", () => {
    expect(daysToExpiry("2026-08-21", new Date("2026-08-11T12:00:00Z"))).toBe(10);
    expect(daysToExpiry("2026-08-01", new Date("2026-08-11T00:00:00Z"))).toBe(-10);
  });

  it("buckets DTE into risk levels", () => {
    expect(riskLevel(-1)).toBe("expired");
    expect(riskLevel(3)).toBe("high");
    expect(riskLevel(20)).toBe("medium");
    expect(riskLevel(60)).toBe("ok");
  });
});

describe("moneyness + risk flags", () => {
  it("detects ITM calls and puts", () => {
    expect(isItmCall(100, 120)).toBe(true);
    expect(isItmCall(100, 90)).toBe(false);
    expect(isItmPut(100, 90)).toBe(true);
    expect(isItmPut(100, 120)).toBe(false);
  });

  it("flags a short ITM leg for assignment and a long OTM leg for worthless expiry", () => {
    const call = parseOccSymbol("AAA260101C00100000")!; // $100 call
    // short (qty<0), ITM (price 120>100), within 30d → assignment risk
    expect(optionRiskFlag(call, -1, 120, 5)).toBe("assignment");
    // long (qty>0), OTM (price 90<100), inside final week → expiry-worthless risk
    expect(optionRiskFlag(call, 1, 90, 3)).toBe("expiry");
    // far from expiry, or no price → no flag
    expect(optionRiskFlag(call, -1, 120, 45)).toBeNull();
    expect(optionRiskFlag(call, 1, null, 3)).toBeNull();
  });
});

describe("classifyOptionLegs", () => {
  it("names a bull call spread from two opposite-sign legs", () => {
    const long = parseOccSymbol("AAA260821C00430000")!; // $430 call
    const short = parseOccSymbol("AAA260821C00450000")!; // $450 call
    const [s] = classifyOptionLegs([
      { parsed: long, quantity: 1 },
      { parsed: short, quantity: -1 },
    ]);
    expect(s.kind).toBe("vertical");
    expect(s.label).toBe("Bull call spread");
  });

  it("labels a lone leg as a long/short single", () => {
    const put = parseOccSymbol("AAA260821P00100000")!;
    const [s] = classifyOptionLegs([{ parsed: put, quantity: -2 }]);
    expect(s.kind).toBe("single");
    expect(s.label).toBe("Short put");
  });

  it("computes correct vertical economics from share-based quantities + cost basis", () => {
    // Regression guard for the reward:risk bug: quantities are SHARES (±100 = 1
    // contract), cost basis is total dollars. The LRCX 410/430 bull call spread.
    const long = parseOccSymbol("LRCX260821C00410000")!;
    const short = parseOccSymbol("LRCX260821C00430000")!;
    const [s] = classifyOptionLegs([
      { parsed: long, quantity: 100, costBasis: 5431.56 },
      { parsed: short, quantity: -100, costBasis: -4530.35 },
    ]);
    expect(s.label).toBe("Bull call spread");
    expect(s.maxProfit).toBeCloseTo(1098.79, 2); // not $199,098.79
    expect(s.maxLoss).toBeCloseTo(901.21, 2);
    expect(s.breakeven).toBeCloseTo(419.01, 2); // not $410.09
    expect(s.maxProfit! / s.maxLoss!).toBeCloseTo(1.22, 2); // not 220.92×
  });
});

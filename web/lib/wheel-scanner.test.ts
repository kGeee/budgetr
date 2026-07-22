import { describe, it, expect } from "vitest";
import { scanPutsForTicker, scoreCandidate, DEFAULT_CRITERIA, type TickerScanInput } from "./wheel-scanner";
import type { OptionChain, OptionQuote } from "./yahoo";

// A fixed "now" so DTE math is deterministic.
const NOW = new Date("2026-01-01T00:00:00Z");
// 2026-02-05 is 35 days out — inside the default 25–45 window.
const EXPIRY = "2026-02-05";

function put(overrides: Partial<OptionQuote> & { strike: number }): OptionQuote {
  return {
    occ: `TEST260205P${String(Math.round(overrides.strike * 1000)).padStart(8, "0")}`,
    expiry: EXPIRY,
    right: "put",
    bid: 1.9,
    ask: 2.1,
    last: 2.0,
    iv: 0.4,
    openInterest: 1500,
    volume: 300,
    inTheMoney: false,
    greeks: { delta: -0.22, gamma: null, theta: null, vega: null, rho: null },
    ...overrides,
  };
}

function chain(contracts: OptionQuote[], underlyingPrice = 100): OptionChain {
  return { underlyingPrice, expirations: [], ivByOcc: {}, contracts };
}

function input(contracts: OptionQuote[], extra: Partial<TickerScanInput> = {}): TickerScanInput {
  return { ticker: "TEST", chain: chain(contracts), spot: 100, ivRank: null, earningsDate: null, ...extra };
}

describe("scanPutsForTicker", () => {
  it("prices a standard OTM put with correct wheel economics", () => {
    // 90 put, $2 mid, 35 DTE, spot 100.
    const [c] = scanPutsForTicker(input([put({ strike: 90 })]), DEFAULT_CRITERIA, NOW);
    expect(c).toBeDefined();
    expect(c.credit).toBeCloseTo(2, 5);
    expect(c.creditTotal).toBeCloseTo(200, 5);
    expect(c.collateral).toBe(9000);
    expect(c.breakeven).toBeCloseTo(88, 5); // strike − credit
    // annualized = credit/strike/dte*365*100 = 2/90/35*365*100 ≈ 23.17%
    expect(c.annualizedPct).toBeCloseTo(23.17, 1);
    expect(c.cushionPct).toBeCloseTo(10, 5); // (100−90)/100
    expect(c.pop).toBeCloseTo(0.78, 5); // 1 − |−0.22|
    // trade plan
    expect(c.entry).toBeCloseTo(2, 5);
    expect(c.stop).toBeCloseTo(4, 5); // 2× credit
    expect(c.stopLossDollars).toBeCloseTo(200, 5); // (4−2)*100
    expect(c.maxAtRisk).toBe(8800); // collateral − creditTotal
  });

  it("excludes ITM puts, out-of-window DTE, and sub-threshold yield", () => {
    const itm = put({ strike: 110 }); // strike ≥ spot → ITM, dropped
    const farExpiry = put({ strike: 90, occ: "TEST260601P00090000", expiry: "2026-06-01" }); // ~150 DTE
    // A tiny-credit put clears delta/OI but fails the min annualized filter.
    const lowYield = put({ strike: 80, bid: 0.05, ask: 0.07, last: 0.06, greeks: { delta: -0.05, gamma: null, theta: null, vega: null, rho: null } });
    const res = scanPutsForTicker(input([itm, farExpiry, lowYield]), DEFAULT_CRITERIA, NOW);
    expect(res).toHaveLength(0);
  });

  it("enforces the delta band only when delta is known", () => {
    const tooDeep = put({ strike: 98, greeks: { delta: -0.45, gamma: null, theta: null, vega: null, rho: null } });
    const noGreeks = put({ strike: 90, iv: null, greeks: null }); // delta unknown → kept
    const res = scanPutsForTicker(input([tooDeep, noGreeks]), DEFAULT_CRITERIA, NOW);
    expect(res.map((c) => c.strike)).toEqual([90]);
    expect(res[0].delta).toBeNull();
  });

  it("flags earnings that fall inside the trade window", () => {
    const withEarnings = scanPutsForTicker(
      input([put({ strike: 90 })], { earningsDate: "2026-01-20" }),
      DEFAULT_CRITERIA,
      NOW,
    );
    expect(withEarnings[0].earningsInWindow).toBe(true);
    const afterExpiry = scanPutsForTicker(
      input([put({ strike: 90 })], { earningsDate: "2026-03-01" }),
      DEFAULT_CRITERIA,
      NOW,
    );
    expect(afterExpiry[0].earningsInWindow).toBe(false);
  });

  it("ranks by score descending", () => {
    const rich = put({ strike: 90, bid: 3.4, ask: 3.6, last: 3.5 }); // higher credit
    const lean = put({ strike: 85, bid: 0.9, ask: 1.1, last: 1.0 });
    const res = scanPutsForTicker(input([lean, rich]), DEFAULT_CRITERIA, NOW);
    expect(res[0].score).toBeGreaterThanOrEqual(res[1].score);
    for (let i = 1; i < res.length; i++) expect(res[i - 1].score).toBeGreaterThanOrEqual(res[i].score);
  });
});

describe("scoreCandidate", () => {
  it("penalizes earnings-in-window and rewards yield + cushion", () => {
    const base = { annualizedPct: 25, ivRank: 60, pop: 0.8, cushionPct: 10, openInterest: 2000, spreadPct: 5 };
    const clean = scoreCandidate({ ...base, earningsInWindow: false });
    const risky = scoreCandidate({ ...base, earningsInWindow: true });
    expect(clean).toBeGreaterThan(risky);
    const richer = scoreCandidate({ ...base, annualizedPct: 40, earningsInWindow: false });
    expect(richer).toBeGreaterThanOrEqual(clean);
  });

  it("stays within 0–100 and tolerates missing inputs", () => {
    const s = scoreCandidate({ annualizedPct: 12, ivRank: null, pop: null, cushionPct: 4, openInterest: null, spreadPct: null, earningsInWindow: false });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

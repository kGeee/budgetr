import { describe, expect, it } from "vitest";
import { bsPrice, impliedVol, normCdf } from "./black-scholes";
import {
  buildFixedStrikeMatrix,
  changeAt,
  defaultStrikes,
  ivAt,
  strikeSeries,
  type IvSnapshotRow,
} from "./fixed-strike-vol-math";

describe("black-scholes", () => {
  it("normCdf hits the landmarks", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("prices satisfy put-call parity", () => {
    const S = 450;
    const K = 460;
    const T = 30 / 365;
    const r = 0.04;
    const call = bsPrice("call", S, K, T, 0.22, r);
    const put = bsPrice("put", S, K, T, 0.22, r);
    expect(call - put).toBeCloseTo(S - K * Math.exp(-r * T), 6);
  });

  it("round-trips: price at a vol, solve the vol back", () => {
    for (const [right, K, sigma] of [
      ["call", 440, 0.18],
      ["put", 470, 0.31],
      ["call", 500, 0.55],
    ] as const) {
      const price = bsPrice(right, 450, K, 45 / 365, sigma);
      const solved = impliedVol(right, price, 450, K, 45 / 365);
      expect(solved).not.toBeNull();
      expect(solved!).toBeCloseTo(sigma, 4);
    }
  });

  it("returns null outside no-arbitrage bounds", () => {
    expect(impliedVol("call", 0, 450, 460, 0.1)).toBeNull(); // free option
    expect(impliedVol("call", 500, 450, 460, 0.1)).toBeNull(); // above spot
    expect(impliedVol("call", 5, 450, 460, 0)).toBeNull(); // expired
  });
});

// ── matrix ───────────────────────────────────────────────────────────

const row = (
  date: string,
  strike: number,
  right: "call" | "put",
  iv: number,
  underlying = 100,
): IvSnapshotRow => ({ date, expiry: "2026-08-21", strike, right, iv, underlying });

const rows: IvSnapshotRow[] = [
  // day 1: spot 100 — 95 put is OTM, 105 call is OTM
  row("2026-07-20", 95, "put", 0.3),
  row("2026-07-20", 95, "call", 0.32), // ITM side — otm mode must ignore it
  row("2026-07-20", 105, "call", 0.24),
  row("2026-07-20", 100, "call", 0.26),
  // day 2: spot rallied to 106 — 105 is now BELOW spot → put side is OTM
  row("2026-07-21", 95, "put", 0.33, 106),
  row("2026-07-21", 105, "put", 0.27, 106),
  row("2026-07-21", 105, "call", 0.28, 106),
  row("2026-07-21", 100, "call", 0.27, 106),
  // other expiry noise — must be filtered out
  { date: "2026-07-21", expiry: "2026-09-18", strike: 100, right: "call", iv: 0.5, underlying: 106 },
];

describe("buildFixedStrikeMatrix", () => {
  it("filters to the expiry, sorts dates asc and strikes desc", () => {
    const m = buildFixedStrikeMatrix(rows, "2026-08-21", "call");
    expect(m.dates).toEqual(["2026-07-20", "2026-07-21"]);
    expect(m.strikes).toEqual([105, 100, 95]);
    expect(ivAt(m, 100, "2026-07-21")).toBeCloseTo(0.27);
    expect(ivAt(m, 100, "2026-09-18")).toBeNull();
  });

  it("otm mode follows THAT day's spot across the strike", () => {
    const m = buildFixedStrikeMatrix(rows, "2026-08-21", "otm");
    // day 1 (spot 100): 105 is above spot → call side
    expect(ivAt(m, 105, "2026-07-20")).toBeCloseTo(0.24);
    // day 2 (spot 106): 105 fell below spot → put side
    expect(ivAt(m, 105, "2026-07-21")).toBeCloseTo(0.27);
    // 95 stays below spot both days → put side; ITM call ignored on day 1
    expect(ivAt(m, 95, "2026-07-20")).toBeCloseTo(0.3);
  });

  it("changeAt reports day-over-day fixed-strike moves in vol points", () => {
    const m = buildFixedStrikeMatrix(rows, "2026-08-21", "call");
    expect(changeAt(m, 100, "2026-07-21")).toBeCloseTo(1.0, 5); // 0.26 → 0.27
    expect(changeAt(m, 100, "2026-07-20")).toBeNull(); // first day has no prior
  });

  it("defaultStrikes brackets the latest spot; strikeSeries skips gaps", () => {
    const m = buildFixedStrikeMatrix(rows, "2026-08-21", "otm");
    expect(defaultStrikes(m, 2)).toEqual([105, 100]); // nearest to spot 106
    expect(strikeSeries(m, 95).map((p) => p.iv)).toEqual([30, 33]);
    // strike 100 flips to the put side on day 2 (spot 106) and no put was
    // captured — the gap is skipped, not zero-filled.
    expect(strikeSeries(m, 100)).toHaveLength(1);
  });
});

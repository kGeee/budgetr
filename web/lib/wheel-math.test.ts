import { describe, expect, it } from "vitest";
import {
  buildShortCycles,
  cumulativeNet,
  mapTrades,
  monthlyPremium,
  rollupByUnderlying,
  type TradeRow,
} from "./wheel-math";

const TODAY = "2026-07-21";

// Real-world sign conventions: sell → amount negative (credit), buy →
// positive (debit), transfer qty ±, amount 0 (expiry/assignment bookkeeping).
const t = (date: string, type: string, ticker: string, quantity: number, amount: number): TradeRow => ({
  date,
  type,
  ticker,
  quantity,
  amount,
});

describe("mapTrades", () => {
  it("splits option events from stock trades and normalizes signs", () => {
    const { events, stocks } = mapTrades([
      t("2026-06-01", "sell", "ABC260619P00095000", 1, -250), // CSP sold: +250 credit
      t("2026-06-10", "buy", "ABC260619P00095000", 1, 80), // bought back: −80
      t("2026-06-19", "buy", "ABC", 100, 9500),
    ]);
    expect(events).toHaveLength(2);
    expect(events[0]!.cash).toBe(250);
    expect(events[1]!.cash).toBe(-80);
    expect(stocks).toEqual([{ date: "2026-06-19", ticker: "ABC", side: "buy", qty: 100, price: null }]);
  });
});

describe("buildShortCycles", () => {
  it("closed cycle: sold then bought back — net = credit − debit", () => {
    const { events, stocks } = mapTrades([
      t("2026-06-01", "sell", "ABC260619P00095000", 1, -250),
      t("2026-06-10", "buy", "ABC260619P00095000", 1, 80),
    ]);
    const [c] = buildShortCycles(events, stocks, TODAY);
    expect(c!.outcome).toBe("closed");
    expect(c!.net).toBe(170);
    expect(c!.closed).toBe("2026-06-10");
    expect(c!.daysHeld).toBe(9);
  });

  it("expired worthless: removal with no matching stock trade keeps full credit", () => {
    const { events, stocks } = mapTrades([
      t("2026-06-01", "sell", "ABC260619P00095000", 1, -250),
      t("2026-06-19", "transfer", "ABC260619P00095000", -1, 0),
    ]);
    const [c] = buildShortCycles(events, stocks, TODAY);
    expect(c!.outcome).toBe("expired");
    expect(c!.net).toBe(250);
    // put collateral 95·100 = 9500 over 18 days → annualized ~53%
    expect(c!.annualizedPct).toBeCloseTo((250 / 9500 / 18) * 365 * 100, 1);
  });

  it("assignment: removal + 100-share stock buy at expiry marks the put assigned", () => {
    const { events, stocks } = mapTrades([
      t("2026-06-01", "sell", "ABC260619P00095000", 1, -250),
      t("2026-06-19", "transfer", "ABC260619P00095000", -1, 0),
      t("2026-06-20", "buy", "ABC", 100, 9500),
    ]);
    const [c] = buildShortCycles(events, stocks, TODAY);
    expect(c!.outcome).toBe("assigned");
  });

  it("covered call called away: removal + 100-share sell near expiry", () => {
    const { events, stocks } = mapTrades([
      t("2026-06-22", "sell", "ABC260717C00105000", 1, -180),
      t("2026-07-17", "transfer", "ABC260717C00105000", -1, 0),
      t("2026-07-17", "sell", "ABC", 100, -10500),
    ]);
    const [c] = buildShortCycles(events, stocks, TODAY);
    expect(c!.outcome).toBe("assigned");
    expect(c!.right).toBe("call");
  });

  it("still-open short and past-expiry-without-close both resolve sensibly", () => {
    const { events, stocks } = mapTrades([
      t("2026-07-10", "sell", "ABC260821P00090000", 1, -300), // future expiry → open
      t("2026-05-01", "sell", "ABC260515P00080000", 1, -120), // expiry passed, nothing recorded → expired
    ]);
    const cycles = buildShortCycles(events, stocks, TODAY);
    const open = cycles.find((c) => c.expiry === "2026-08-21")!;
    const stale = cycles.find((c) => c.expiry === "2026-05-15")!;
    expect(open.outcome).toBe("open");
    expect(open.closed).toBeNull();
    expect(stale.outcome).toBe("expired");
    expect(stale.closed).toBe("2026-05-15");
  });

  it("long premium (buy first — debit spreads' long legs) is excluded", () => {
    const { events, stocks } = mapTrades([
      t("2026-06-01", "buy", "ABC260619C00100000", 1, 400),
      t("2026-06-01", "sell", "ABC260619C00110000", 1, -150),
    ]);
    const cycles = buildShortCycles(events, stocks, TODAY);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.strike).toBe(110);
  });
});

describe("income reporting", () => {
  it("monthlyPremium nets credits against debits across ALL option trades", () => {
    const { events } = mapTrades([
      t("2026-06-01", "sell", "ABC260619P00095000", 1, -250),
      t("2026-06-01", "buy", "ABC260619P00090000", 1, 100), // spread long leg subtracts
      t("2026-07-02", "sell", "ABC260717P00095000", 1, -300),
      t("2026-07-17", "transfer", "ABC260717P00095000", -1, 0), // removals are not cash
    ]);
    const months = monthlyPremium(events);
    expect(months).toEqual([
      { month: "2026-06", credits: 250, debits: 100, net: 150, trades: 2 },
      { month: "2026-07", credits: 300, debits: 0, net: 300, trades: 1 },
    ]);
    expect(cumulativeNet(months).map((c) => c.cumulative)).toEqual([150, 450]);
  });

  it("rollupByUnderlying computes win rate over finished cycles only", () => {
    const { events, stocks } = mapTrades([
      t("2026-05-01", "sell", "ABC260515P00080000", 1, -120), // expired → win
      t("2026-06-01", "sell", "ABC260619P00095000", 1, -100),
      t("2026-06-10", "buy", "ABC260619P00095000", 1, 180), // closed at a loss
      t("2026-07-10", "sell", "ABC260821P00090000", 1, -300), // open — not in win rate
    ]);
    const [r] = rollupByUnderlying(buildShortCycles(events, stocks, TODAY));
    expect(r!.cycles).toBe(3);
    expect(r!.open).toBe(1);
    expect(r!.winRatePct).toBe(50);
    expect(r!.net).toBe(120 - 80 + 300);
  });
});

import { describe, it, expect } from "vitest";
import { buildReconcile } from "@/lib/import/import-service";
import type { CanonicalTrade } from "@/lib/import/canonicalize";

const trade = (over: Partial<CanonicalTrade>): CanonicalTrade => ({
  fitid: null,
  date: "2021-01-01",
  ticker: "AAPL",
  securityName: "Apple",
  securityType: "stock",
  isoCurrencyCode: "USD",
  type: "buy",
  subtype: null,
  name: "BUY",
  side: "buy",
  quantity: 10,
  amount: 2000,
  price: 200,
  fees: 0,
  isOption: false,
  ...over,
});

const meta = { broker: "schwab.com", fileHash: "h", dateStart: "2021-01-01", dateEnd: "2024-01-01" };

describe("buildReconcile", () => {
  it("nets positions per ticker and counts buys/sells", () => {
    const s = buildReconcile(
      [
        trade({ ticker: "AAPL", quantity: 10 }),
        trade({ ticker: "AAPL", quantity: -4, type: "sell", side: "sell", amount: -1000 }),
        trade({ ticker: "MSFT", quantity: 5 }),
      ],
      meta,
    );
    expect(s.symbolCount).toBe(2);
    const aapl = s.positions.find((p) => p.ticker === "AAPL")!;
    expect(aapl).toMatchObject({ quantity: 6, buys: 1, sells: 1 });
    expect(s.warnings.filter((w) => w.level === "warn")).toHaveLength(0); // no hard deficit
  });

  it("warns when a sell has no covering buy in the file (the engine's silent drop)", () => {
    const s = buildReconcile(
      [
        trade({ date: "2024-02-01", ticker: "TSLA", quantity: -30, type: "sell", side: "sell", amount: -9000 }),
        trade({ date: "2024-01-01", ticker: "TSLA", quantity: 10, amount: 2000 }),
      ],
      meta,
    );
    const warn = s.warnings.find((w) => w.ticker === "TSLA");
    expect(warn?.level).toBe("warn");
    expect(warn?.message).toContain("20"); // 30 sold − 10 opened = 20 uncovered
  });

  it("does not warn when buys precede and cover the sells chronologically", () => {
    const s = buildReconcile(
      [
        trade({ date: "2024-02-01", ticker: "NVDA", quantity: -10, type: "sell", side: "sell", amount: -5000 }),
        trade({ date: "2024-01-01", ticker: "NVDA", quantity: 10, amount: 2000 }),
      ],
      meta,
    );
    expect(s.warnings.filter((w) => w.level === "warn")).toHaveLength(0);
  });

  it("reports untickered rows as an info note", () => {
    const s = buildReconcile([trade({ ticker: null })], meta);
    expect(s.positions).toHaveLength(0);
    expect(s.warnings.some((w) => w.level === "info")).toBe(true);
  });

  it("flags wash-sale incompleteness when a sale sits within 30 days of the file start", () => {
    const s = buildReconcile(
      [
        trade({ date: "2023-01-01", ticker: "AAPL", quantity: 10, amount: 2000 }),
        trade({ date: "2023-01-15", ticker: "AAPL", quantity: -10, type: "sell", side: "sell", amount: -1800 }),
      ],
      { ...meta, dateStart: "2023-01-01" },
    );
    const note = s.warnings.find((w) => w.ticker === "AAPL" && w.level === "info");
    expect(note?.message).toContain("wash-sale");
  });

  it("does not flag wash-sale incompleteness for a sale well after the file start", () => {
    const s = buildReconcile(
      [
        trade({ date: "2023-01-01", ticker: "AAPL", quantity: 10, amount: 2000 }),
        trade({ date: "2023-06-01", ticker: "AAPL", quantity: -10, type: "sell", side: "sell", amount: -1800 }),
      ],
      { ...meta, dateStart: "2023-01-01" },
    );
    expect(s.warnings.some((w) => w.message.includes("wash-sale"))).toBe(false);
  });
});

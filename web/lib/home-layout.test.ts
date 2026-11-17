import { describe, expect, it } from "vitest";
import {
  OVERVIEW_DEFAULT_WIDGETS,
  WIDGET_SLOT,
  layoutBands,
  monthPace,
  paceState,
  portfolioTotals,
  presentOrder,
} from "./home-layout";

describe("layoutBands", () => {
  const slot = (s: string) => (s[0] === "F" ? "full" : s[0] === "M" ? "main" : "side");

  it("gives a full-width item its own band and pairs the rest into columns", () => {
    expect(layoutBands(["F1", "M1", "S1", "S2", "M2"], slot)).toEqual([
      { kind: "full", item: "F1" },
      { kind: "columns", main: ["M1", "M2"], side: ["S1", "S2"] },
    ]);
  });

  it("starts a new column band after each full-width item", () => {
    expect(layoutBands(["M1", "F1", "S1"], slot)).toEqual([
      { kind: "columns", main: ["M1"], side: [] },
      { kind: "full", item: "F1" },
      { kind: "columns", main: [], side: ["S1"] },
    ]);
  });

  it("lays the stock board out as the hero over two columns", () => {
    const bands = layoutBands(OVERVIEW_DEFAULT_WIDGETS, (w) => WIDGET_SLOT[w.type]);
    expect(bands).toHaveLength(2);
    expect(bands[0]).toEqual({ kind: "full", item: { type: "net-worth-summary" } });
    const cols = bands[1];
    if (cols.kind !== "columns") throw new Error("expected columns");
    expect(cols.main[0].type).toBe("recent-activity");
    expect(cols.side.slice(0, 2).map((w) => w.type)).toEqual(["budget-summary", "upcoming-bills"]);
  });
});

describe("presentOrder", () => {
  const legacy = [
    "net-worth-summary",
    "spending-review",
    "cashflow",
    "spend-by-category",
    "budget-summary",
    "recent-activity",
    "upcoming-bills",
  ].map((type, i) => ({ id: `dw_ov_${i}`, type }));

  it("shows an untouched legacy board in the stock order", () => {
    expect(presentOrder(legacy).map((w) => w.type)).toEqual(
      OVERVIEW_DEFAULT_WIDGETS.map((w) => w.type),
    );
  });

  it("leaves a reordered board alone", () => {
    const moved = [legacy[1], legacy[0], ...legacy.slice(2)];
    expect(presentOrder(moved)).toBe(moved);
  });

  it("leaves a board with a widget removed or added alone", () => {
    const fewer = legacy.slice(0, 6);
    expect(presentOrder(fewer)).toBe(fewer);
    const more = [...legacy, { id: "dw_abc", type: "top-vendors" }];
    expect(presentOrder(more)).toBe(more);
  });
});

describe("monthPace", () => {
  it("places today inside the current month", () => {
    expect(monthPace("2026-07", new Date(2026, 6, 15))).toEqual({
      day: 15,
      daysInMonth: 31,
      daysLeft: 16,
      elapsed: 15 / 31,
    });
  });

  it("treats a past budget month as finished", () => {
    expect(monthPace("2026-02", new Date(2026, 6, 15))).toEqual({
      day: 28,
      daysInMonth: 28,
      daysLeft: 0,
      elapsed: 1,
    });
  });

  it("treats a future budget month as not started", () => {
    expect(monthPace("2027-01", new Date(2026, 11, 31)).elapsed).toBe(0);
  });
});

describe("paceState", () => {
  it("reports no state without a budget", () => {
    expect(paceState(0, 50, 0.5)).toBe("none");
  });
  it("separates over budget from over pace", () => {
    expect(paceState(100, 120, 0.5)).toBe("over-budget");
    expect(paceState(100, 70, 0.5)).toBe("over-pace");
  });
  it("reads under and on pace", () => {
    expect(paceState(100, 20, 0.5)).toBe("under-pace");
    expect(paceState(100, 51, 0.5)).toBe("on-pace");
  });
});

describe("portfolioTotals", () => {
  it("sums value and measures gain only where cost is known", () => {
    expect(
      portfolioTotals([
        { value: 150, costBasis: 100 },
        { value: 50, costBasis: null },
        { value: null, costBasis: 10 },
      ]),
    ).toEqual({ value: 200, gain: 50, gainPct: 50, count: 2 });
  });

  it("has no gain when no holding reports a cost", () => {
    expect(portfolioTotals([{ value: 10, costBasis: null }])).toEqual({
      value: 10,
      gain: null,
      gainPct: null,
      count: 1,
    });
  });
});

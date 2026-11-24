import { describe, expect, it } from "vitest";
import { CHART_LIMITS, describeChart, parseChartSpec } from "./chart-spec";

describe("parseChartSpec", () => {
  it("accepts a line chart and defaults the unit to currency", () => {
    const r = parseChartSpec({
      type: "line",
      title: "  Dining  by month ",
      labels: ["2026-01", "2026-02", "2026-03"],
      series: [{ name: "Dining", values: [120, 98.5, 143] }],
    });
    expect(r).toEqual({
      ok: true,
      spec: {
        type: "line",
        title: "Dining by month",
        subtitle: undefined,
        unit: "currency",
        labels: ["2026-01", "2026-02", "2026-03"],
        series: [{ name: "Dining", values: [120, 98.5, 143] }],
      },
    });
  });

  it("accepts a multi-series bar chart and coerces numeric strings", () => {
    const r = parseChartSpec({
      type: "bar",
      title: "Income vs spending",
      unit: "currency",
      labels: ["Jan", "Feb"],
      series: [
        { name: "Income", values: ["5000", 5100] },
        { name: "Spending", values: [4200, 4800] },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.spec.type !== "table") expect(r.spec.series[0].values).toEqual([5000, 5100]);
  });

  it("names an unnamed series", () => {
    const r = parseChartSpec({ type: "bar", title: "T", labels: ["a"], series: [{ values: [1] }] });
    expect(r.ok && r.spec.type === "bar" && r.spec.series[0].name).toBe("Series 1");
  });

  it("rejects a series whose length doesn't match the labels", () => {
    const r = parseChartSpec({
      type: "bar",
      title: "T",
      labels: ["a", "b"],
      series: [{ name: "x", values: [1] }],
    });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/exactly one number per label/);
  });

  it("rejects non-finite values", () => {
    for (const bad of [NaN, Infinity, null, "abc", {}]) {
      const r = parseChartSpec({ type: "line", title: "T", labels: ["a"], series: [{ name: "x", values: [bad] }] });
      expect(r.ok).toBe(false);
    }
  });

  it("holds a pie to one non-negative series", () => {
    expect(
      parseChartSpec({ type: "pie", title: "T", labels: ["a", "b"], series: [{ name: "x", values: [1, 2] }, { name: "y", values: [1, 2] }] }).ok,
    ).toBe(false);
    expect(parseChartSpec({ type: "pie", title: "T", labels: ["a", "b"], series: [{ name: "x", values: [1, -2] }] }).ok).toBe(false);
    expect(parseChartSpec({ type: "pie", title: "T", labels: ["a", "b"], series: [{ name: "x", values: [0, 0] }] }).ok).toBe(false);
    expect(parseChartSpec({ type: "pie", title: "T", labels: ["a", "b"], series: [{ name: "x", values: [3, 1] }] }).ok).toBe(true);
  });

  it("caps the number of points, slices and series", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
    const r1 = parseChartSpec({
      type: "line",
      title: "T",
      labels: many(CHART_LIMITS.points + 1),
      series: [{ name: "x", values: many(CHART_LIMITS.points + 1).map(() => 1) }],
    });
    expect(!r1.ok && r1.error).toMatch(/Too many labels/);

    const r2 = parseChartSpec({
      type: "pie",
      title: "T",
      labels: many(CHART_LIMITS.slices + 1),
      series: [{ name: "x", values: many(CHART_LIMITS.slices + 1).map(() => 1) }],
    });
    expect(!r2.ok && r2.error).toMatch(/Other/);

    const r3 = parseChartSpec({
      type: "bar",
      title: "T",
      labels: ["a"],
      series: many(CHART_LIMITS.series + 1).map((n) => ({ name: n, values: [1] })),
    });
    expect(r3.ok).toBe(false);
  });

  it("rejects unknown types and units, a missing title, and non-objects", () => {
    expect(parseChartSpec({ type: "scatter", title: "T", labels: ["a"], series: [{ name: "x", values: [1] }] }).ok).toBe(false);
    expect(parseChartSpec({ type: "bar", title: "T", unit: "euros", labels: ["a"], series: [{ name: "x", values: [1] }] }).ok).toBe(false);
    expect(parseChartSpec({ type: "bar", labels: ["a"], series: [{ name: "x", values: [1] }] }).ok).toBe(false);
    expect(parseChartSpec("<script>alert(1)</script>").ok).toBe(false);
    expect(parseChartSpec([1, 2]).ok).toBe(false);
  });

  it("truncates long strings", () => {
    const r = parseChartSpec({
      type: "bar",
      title: "x".repeat(500),
      labels: ["y".repeat(500)],
      series: [{ name: "z", values: [1] }],
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.spec.type === "bar") {
      expect(r.spec.title.length).toBe(CHART_LIMITS.title);
      expect(r.spec.labels[0].length).toBe(CHART_LIMITS.label);
    }
  });

  it("accepts a table with mixed string and number cells", () => {
    const r = parseChartSpec({
      type: "table",
      title: "Top merchants",
      subtitle: "Last 90 days",
      columns: ["Merchant", "Visits", "Spent"],
      rows: [
        ["Costco", "6", 812.4],
        ["Trader Joe's", "9", 401.1],
      ],
    });
    expect(r).toMatchObject({ ok: true, spec: { type: "table", subtitle: "Last 90 days", unit: "currency" } });
  });

  it("rejects ragged or oversized tables", () => {
    expect(parseChartSpec({ type: "table", title: "T", columns: ["a", "b"], rows: [["x"]] }).ok).toBe(false);
    expect(parseChartSpec({ type: "table", title: "T", columns: ["a"], rows: [[{}]] }).ok).toBe(false);
    expect(
      parseChartSpec({
        type: "table",
        title: "T",
        columns: ["a"],
        rows: Array.from({ length: CHART_LIMITS.rows + 1 }, () => ["x"]),
      }).ok,
    ).toBe(false);
  });
});

describe("describeChart", () => {
  it("names the chart for the replayed history", () => {
    const r = parseChartSpec({ type: "pie", title: "Spending mix", labels: ["a"], series: [{ name: "x", values: [1] }] });
    expect(r.ok && describeChart(r.spec)).toBe("[Showed the user a pie chart: Spending mix]");
    const t = parseChartSpec({ type: "table", title: "Bills", columns: ["a"], rows: [["x"]] });
    expect(t.ok && describeChart(t.spec)).toBe("[Showed the user a table: Bills]");
  });
});

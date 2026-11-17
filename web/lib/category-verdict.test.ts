import { describe, expect, it } from "vitest";
import { categoryVerdict } from "./category-verdict";

describe("categoryVerdict", () => {
  it("returns null with no months", () => {
    expect(categoryVerdict([])).toBeNull();
  });

  it("has nothing to compare a single month to", () => {
    const v = categoryVerdict([{ month: "2026-07", amount: 120 }]);
    expect(v).toMatchObject({ month: "2026-07", current: 120, usual: null, tone: "muted" });
    expect(v?.total).toBe(120);
    expect(v?.average).toBe(120);
  });

  it("reads the newest month against the mean of the earlier ones, in any order", () => {
    const v = categoryVerdict([
      { month: "2026-07", amount: 50 },
      { month: "2026-05", amount: 100 },
      { month: "2026-06", amount: 200 },
    ]);
    expect(v?.month).toBe("2026-07");
    expect(v?.current).toBe(50);
    expect(v?.usual).toBe(150);
    expect(v?.total).toBe(350);
    expect(v?.tone).toBe("jade");
  });

  it("turns brass once the month runs more than 5% over the usual", () => {
    const base = [
      { month: "2026-05", amount: 100 },
      { month: "2026-06", amount: 100 },
    ];
    expect(categoryVerdict([...base, { month: "2026-07", amount: 104 }])?.tone).toBe("jade");
    expect(categoryVerdict([...base, { month: "2026-07", amount: 106 }])?.tone).toBe("brass");
  });
});

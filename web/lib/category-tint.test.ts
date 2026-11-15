import { describe, expect, it } from "vitest";
import { TINT_HUES, categoryHue } from "./category-tint";

describe("categoryHue", () => {
  it("is stable for the same key", () => {
    expect(categoryHue("cat_food")).toBe(categoryHue("cat_food"));
  });

  it("always lands on the hue ring", () => {
    for (const key of ["", "a", "cat_rent", "Uncategorized", "x".repeat(200)]) {
      expect(TINT_HUES).toContain(categoryHue(key));
    }
  });

  it("spreads different keys across more than one hue", () => {
    const hues = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(categoryHue));
    expect(hues.size).toBeGreaterThan(1);
  });
});

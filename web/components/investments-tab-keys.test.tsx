import { describe, expect, it } from "vitest";
import { investmentsTabHref, parseInvestmentsTab } from "@/components/investments-tab-keys";

describe("investments ?tab=", () => {
  it("defaults unknown and missing values to holdings", () => {
    expect(parseInvestmentsTab(undefined)).toBe("holdings");
    expect(parseInvestmentsTab("analysis")).toBe("holdings");
    expect(parseInvestmentsTab("allocation")).toBe("allocation");
    expect(parseInvestmentsTab("income")).toBe("income");
  });

  it("gives the default tab the bare URL", () => {
    expect(investmentsTabHref("holdings")).toBe("/investments");
    expect(investmentsTabHref("income")).toBe("/investments?tab=income");
  });
});

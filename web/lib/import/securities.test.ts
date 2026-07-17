import { describe, it, expect } from "vitest";
import { importSecurityId } from "@/lib/import/securities";

describe("importSecurityId", () => {
  it("derives a deterministic sym: id from the symbol", () => {
    expect(importSecurityId("AAPL")).toBe("sym:AAPL");
  });

  it("normalizes case and whitespace so imports dedupe to one row", () => {
    expect(importSecurityId(" aapl ")).toBe("sym:AAPL");
    expect(importSecurityId("aapl")).toBe(importSecurityId("AAPL"));
  });

  it("preserves the full OCC option symbol (needed for §1256 detection)", () => {
    expect(importSecurityId("SPXW240119C05000000")).toBe("sym:SPXW240119C05000000");
  });
});

import { describe, it, expect } from "vitest";
import { parseIncomeStatement, toSankey, type CompanyFacts } from "@/lib/fundamentals/income-statement";

const annual = (val: number) => ({ start: "2022-10-01", end: "2023-09-30", val, fy: 2023, fp: "FY", form: "10-K" });
const usd = (val: number) => ({ units: { USD: [annual(val)] } });

// AAPL-shaped FY2023 (rounded), plus an older year to prove we pick the latest.
const AAPL: CompanyFacts = {
  entityName: "Apple Inc.",
  facts: {
    "us-gaap": {
      RevenueFromContractWithCustomerExcludingAssessedTax: {
        units: {
          USD: [
            { start: "2021-09-26", end: "2022-09-24", val: 394328_000000, fy: 2022, fp: "FY", form: "10-K" },
            annual(383285_000000),
          ],
        },
      },
      CostOfGoodsAndServicesSold: usd(214137_000000),
      GrossProfit: usd(169148_000000),
      OperatingIncomeLoss: usd(114301_000000),
      IncomeTaxExpenseBenefit: usd(16741_000000),
      NetIncomeLoss: usd(96995_000000),
    },
  },
};

describe("parseIncomeStatement", () => {
  it("extracts the latest annual income statement", () => {
    const is = parseIncomeStatement(AAPL)!;
    expect(is).toMatchObject({
      entityName: "Apple Inc.",
      periodEnd: "2023-09-30", // latest, not the 2022 point
      fiscalYear: 2023,
      revenue: 383285_000000,
      costOfRevenue: 214137_000000,
      grossProfit: 169148_000000,
      operatingIncome: 114301_000000,
      tax: 16741_000000,
      netIncome: 96995_000000,
    });
    expect(is.operatingExpenses).toBe(169148_000000 - 114301_000000);
  });

  it("derives gross profit from revenue − cost when the tag is absent", () => {
    const noGross: CompanyFacts = {
      facts: {
        "us-gaap": {
          Revenues: usd(1000),
          CostOfRevenue: usd(600),
          OperatingIncomeLoss: usd(250),
          IncomeTaxExpenseBenefit: usd(50),
          NetIncomeLoss: usd(200),
        },
      },
    };
    const is = parseIncomeStatement(noGross)!;
    expect(is.grossProfit).toBe(400); // 1000 − 600
    expect(is.operatingExpenses).toBe(150); // 400 − 250
  });

  it("returns null when revenue or net income can't be found", () => {
    expect(parseIncomeStatement({ facts: { "us-gaap": {} } })).toBeNull();
  });

  it("ignores quarterly/partial points (only full-year 10-K)", () => {
    const withQuarter: CompanyFacts = {
      facts: {
        "us-gaap": {
          Revenues: {
            units: {
              USD: [
                { start: "2023-07-01", end: "2023-09-30", val: 90, fy: 2023, fp: "Q3", form: "10-Q" }, // ignored
                annual(383285_000000),
              ],
            },
          },
          NetIncomeLoss: usd(96995_000000),
        },
      },
    };
    expect(parseIncomeStatement(withQuarter)!.revenue).toBe(383285_000000);
  });
});

describe("toSankey", () => {
  it("builds the profit spine + cost outflows, dropping zero flows", () => {
    const { nodes, links } = toSankey(parseIncomeStatement(AAPL)!);
    expect(nodes.map((n) => n.name)).toEqual([
      "Revenue",
      "Cost of revenue",
      "Gross profit",
      "Operating expenses",
      "Operating income",
      "Tax",
      "Net income",
    ]);
    // Revenue conserves: cost + gross = revenue
    const fromRevenue = links.filter((l) => l.source === 0);
    expect(fromRevenue.reduce((s, l) => s + l.value, 0)).toBe(383285_000000);
    // Net income link value = operating income − tax
    const toNet = links.find((l) => l.target === 6)!;
    expect(toNet.value).toBe(114301_000000 - 16741_000000);
    expect(links.every((l) => l.value > 0)).toBe(true);
  });
});

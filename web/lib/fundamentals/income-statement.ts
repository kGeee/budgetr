/**
 * Turn SEC "companyfacts" XBRL data into a normalized annual income statement and
 * a Sankey flow — pure, no network. companyfacts exposes every reported us-gaap
 * concept as time series; we pick the latest full fiscal year and pull the income
 * statement line items (with fallbacks, since tickers tag concepts differently).
 */

/** The subset of the companyfacts JSON we read. */
export type CompanyFacts = {
  cik?: number;
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<string, { units?: { USD?: FactPoint[] } }>;
  };
};
type FactPoint = { start?: string; end: string; val: number; fy?: number; fp?: string; form?: string };

export type IncomeStatement = {
  entityName: string | null;
  periodEnd: string; // YYYY-MM-DD of the fiscal year
  fiscalYear: number | null;
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingIncome: number;
  tax: number;
  netIncome: number;
};

const REVENUE = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
];
const COST_OF_REVENUE = ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"];
const GROSS_PROFIT = ["GrossProfit"];
const OPERATING_INCOME = ["OperatingIncomeLoss"];
const TAX = ["IncomeTaxExpenseBenefit"];
const NET_INCOME = ["NetIncomeLoss", "ProfitLoss"];

function series(facts: CompanyFacts, concept: string): FactPoint[] {
  return facts.facts?.["us-gaap"]?.[concept]?.units?.USD ?? [];
}

function days(a: string, b: string): number {
  return Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;
}

/** A full-fiscal-year (10-K, ~365-day duration) point ending on `periodEnd`. */
function annualValue(facts: CompanyFacts, concepts: string[], periodEnd: string): number | null {
  for (const c of concepts) {
    const pt = series(facts, c).find(
      (p) => p.form === "10-K" && p.end === periodEnd && p.start != null && days(p.start, p.end) > 300,
    );
    if (pt) return pt.val;
  }
  return null;
}

/** Extract the latest annual income statement, or null if revenue/net income are missing. */
export function parseIncomeStatement(facts: CompanyFacts): IncomeStatement | null {
  // Anchor on the latest annual Net Income period end.
  const anchors = NET_INCOME.flatMap((c) => series(facts, c)).filter(
    (p) => p.form === "10-K" && p.start != null && days(p.start!, p.end) > 300,
  );
  if (!anchors.length) return null;
  const periodEnd = anchors.reduce((a, b) => (b.end > a ? b.end : a), anchors[0].end);
  const fy = anchors.find((p) => p.end === periodEnd)?.fy ?? null;

  const revenue = annualValue(facts, REVENUE, periodEnd);
  const netIncome = annualValue(facts, NET_INCOME, periodEnd);
  if (revenue == null || netIncome == null) return null;

  const costOfRevenue = annualValue(facts, COST_OF_REVENUE, periodEnd) ?? 0;
  const grossProfit = annualValue(facts, GROSS_PROFIT, periodEnd) ?? revenue - costOfRevenue;
  const operatingIncome = annualValue(facts, OPERATING_INCOME, periodEnd) ?? netIncome;
  const tax = annualValue(facts, TAX, periodEnd) ?? Math.max(0, operatingIncome - netIncome);

  return {
    entityName: facts.entityName ?? null,
    periodEnd,
    fiscalYear: fy,
    revenue,
    costOfRevenue: Math.abs(costOfRevenue),
    grossProfit,
    operatingExpenses: Math.max(0, grossProfit - operatingIncome),
    operatingIncome,
    tax: Math.abs(tax),
    netIncome,
  };
}

export type SankeyNode = { name: string; kind: "revenue" | "profit" | "cost" };
export type SankeyLink = { source: number; target: number; value: number };
export type SankeyData = { nodes: SankeyNode[]; links: SankeyLink[] };

/**
 * A 3-stage income-statement Sankey: Revenue → Gross profit → Operating income →
 * Net income (the profit spine), bleeding off Cost of revenue, Operating expenses
 * and Tax. Zero/negative flows are dropped so recharts renders cleanly.
 */
export function toSankey(is: IncomeStatement): SankeyData {
  const nodes: SankeyNode[] = [
    { name: "Revenue", kind: "revenue" }, // 0
    { name: "Cost of revenue", kind: "cost" }, // 1
    { name: "Gross profit", kind: "profit" }, // 2
    { name: "Operating expenses", kind: "cost" }, // 3
    { name: "Operating income", kind: "profit" }, // 4
    { name: "Tax", kind: "cost" }, // 5
    { name: "Net income", kind: "profit" }, // 6
  ];
  const raw: SankeyLink[] = [
    { source: 0, target: 1, value: is.costOfRevenue },
    { source: 0, target: 2, value: is.grossProfit },
    { source: 2, target: 3, value: is.operatingExpenses },
    { source: 2, target: 4, value: is.operatingIncome },
    { source: 4, target: 5, value: is.tax },
    { source: 4, target: 6, value: Math.max(0, is.operatingIncome - is.tax) },
  ];
  return { nodes, links: raw.filter((l) => l.value > 0) };
}

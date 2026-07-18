/**
 * Turn SEC "companyfacts" XBRL data into a normalized income statement and a
 * Sankey flow — pure, no network. companyfacts exposes every reported us-gaap
 * concept as time series; we pick the latest period (full fiscal year or latest
 * quarter) and pull the income-statement line items, with fallbacks since tickers
 * tag concepts differently.
 *
 * Note: companyfacts is dimensionless — it has NO business-segment breakdown
 * (that lives in dimensional XBRL / the Financial Statement Data Sets). So the
 * breakdown we surface is the operating-EXPENSE side (R&D, SG&A, …), which
 * companyfacts does report.
 */

export type Period = "annual" | "quarterly";

export type CompanyFacts = {
  cik?: number;
  entityName?: string;
  facts?: { "us-gaap"?: Record<string, { units?: { USD?: FactPoint[] } }> };
};
type FactPoint = { start?: string; end: string; val: number; fy?: number; fp?: string; form?: string };

export type OpexLine = { label: string; value: number };

export type IncomeStatement = {
  entityName: string | null;
  period: Period;
  periodEnd: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null; // FY | Q1 | Q2 | …
  revenue: number;
  costOfRevenue: number;
  grossProfit: number;
  operatingExpenses: number;
  opex: OpexLine[]; // R&D / SG&A / Other — the expense breakdown
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
const RND = ["ResearchAndDevelopmentExpense"];
const SGA = [
  "SellingGeneralAndAdministrativeExpense",
  "GeneralAndAdministrativeExpense",
];

function series(facts: CompanyFacts, concept: string): FactPoint[] {
  return facts.facts?.["us-gaap"]?.[concept]?.units?.USD ?? [];
}
function days(a: string, b: string): number {
  return Math.abs(Date.parse(b) - Date.parse(a)) / 86_400_000;
}

/** Does this point cover the target period type (annual ~1yr 10-K, quarterly ~1q 10-Q)? */
function coversPeriod(p: FactPoint, period: Period): boolean {
  if (p.start == null) return false;
  const d = days(p.start, p.end);
  return period === "annual" ? p.form === "10-K" && d > 300 : d >= 60 && d <= 110;
}

function periodValue(facts: CompanyFacts, concepts: string[], periodEnd: string, period: Period): number | null {
  for (const c of concepts) {
    const pt = series(facts, c).find((p) => p.end === periodEnd && coversPeriod(p, period));
    if (pt) return pt.val;
  }
  return null;
}

/** Extract the latest income statement for the given period, or null if unavailable. */
export function parseIncomeStatement(facts: CompanyFacts, period: Period = "annual"): IncomeStatement | null {
  const anchors = NET_INCOME.flatMap((c) => series(facts, c)).filter((p) => coversPeriod(p, period));
  if (!anchors.length) return null;
  const periodEnd = anchors.reduce((a, b) => (b.end > a ? b.end : a), anchors[0].end);
  const anchor = anchors.find((p) => p.end === periodEnd);

  const revenue = periodValue(facts, REVENUE, periodEnd, period);
  const netIncome = periodValue(facts, NET_INCOME, periodEnd, period);
  if (revenue == null || netIncome == null) return null;

  const costOfRevenue = Math.abs(periodValue(facts, COST_OF_REVENUE, periodEnd, period) ?? 0);
  const grossProfit = periodValue(facts, GROSS_PROFIT, periodEnd, period) ?? revenue - costOfRevenue;
  const operatingIncome = periodValue(facts, OPERATING_INCOME, periodEnd, period) ?? netIncome;
  const tax = Math.abs(periodValue(facts, TAX, periodEnd, period) ?? Math.max(0, operatingIncome - netIncome));
  const operatingExpenses = Math.max(0, grossProfit - operatingIncome);

  // Expense breakdown from what companyfacts reports; the remainder is "Other".
  const rnd = periodValue(facts, RND, periodEnd, period);
  const sga = periodValue(facts, SGA, periodEnd, period);
  const opex: OpexLine[] = [];
  if (rnd && rnd > 0) opex.push({ label: "R&D", value: rnd });
  if (sga && sga > 0) opex.push({ label: "SG&A", value: sga });
  const tagged = opex.reduce((s, o) => s + o.value, 0);
  const other = operatingExpenses - tagged;
  if (opex.length && other > operatingExpenses * 0.01) opex.push({ label: "Other opex", value: other });

  return {
    entityName: facts.entityName ?? null,
    period,
    periodEnd,
    fiscalYear: anchor?.fy ?? null,
    fiscalPeriod: anchor?.fp ?? null,
    revenue,
    costOfRevenue,
    grossProfit,
    operatingExpenses,
    opex,
    operatingIncome,
    tax,
    netIncome,
  };
}

export type SankeyNode = { name: string; kind: "revenue" | "profit" | "cost" };
export type SankeyLink = { source: number; target: number; value: number };
export type SankeyData = { nodes: SankeyNode[]; links: SankeyLink[] };

/**
 * Income-statement Sankey: Revenue → Gross profit → Operating income → Net income
 * (the profit spine, jade), with Cost of revenue, the operating-expense breakdown,
 * and Tax bleeding off (coral). Zero/negative flows are dropped.
 */
export function toSankey(is: IncomeStatement): SankeyData {
  const nodes: SankeyNode[] = [
    { name: "Revenue", kind: "revenue" }, // 0
    { name: "Cost of revenue", kind: "cost" }, // 1
    { name: "Gross profit", kind: "profit" }, // 2
    { name: "Operating income", kind: "profit" }, // 3
    { name: "Tax", kind: "cost" }, // 4
    { name: "Net income", kind: "profit" }, // 5
  ];
  const links: SankeyLink[] = [
    { source: 0, target: 1, value: is.costOfRevenue },
    { source: 0, target: 2, value: is.grossProfit },
    { source: 2, target: 3, value: is.operatingIncome },
    { source: 3, target: 4, value: is.tax },
    { source: 3, target: 5, value: Math.max(0, is.operatingIncome - is.tax) },
  ];

  // Gross profit → each expense line (or a single "Operating expenses" node).
  if (is.opex.length >= 2) {
    for (const line of is.opex) {
      const idx = nodes.push({ name: line.label, kind: "cost" }) - 1;
      links.push({ source: 2, target: idx, value: line.value });
    }
  } else if (is.operatingExpenses > 0) {
    const idx = nodes.push({ name: "Operating expenses", kind: "cost" }) - 1;
    links.push({ source: 2, target: idx, value: is.operatingExpenses });
  }

  return { nodes, links: links.filter((l) => l.value > 0) };
}

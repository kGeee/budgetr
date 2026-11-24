/**
 * The tools the assistant can call. Every data tool is read-only, reads the
 * local SQLite database through the same queries the pages use, and returns
 * only what the question needs: no raw table dumps, no account numbers, no
 * notes, no Plaid identifiers. `render_chart` is the only way a visual reaches
 * the screen (see chart-spec.ts).
 *
 * Inputs come from the model, so each tool validates its own input and throws a
 * ToolInputError with a message Claude can act on; the loop turns that into an
 * `is_error` tool result.
 *
 * Server-only.
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  getAccounts,
  getBudgetMonth,
  getBudgetsWithSpend,
  getCategories,
  getHoldings,
  getImportedHoldings,
  getRecurringStreams,
  searchTransactions,
  summarizeTransactions,
  type TxnCriteria,
} from "@/lib/queries";
import { loadInclusiveNetWorth } from "@/lib/net-worth";
import { CHART_INPUT_SCHEMA } from "./chart-spec";
import {
  cashflowOverTime,
  lastPerBucket,
  spendingByCategory,
  topMerchants,
  type Granularity,
} from "./queries";

export class ToolInputError extends Error {}

export const RENDER_CHART = "render_chart";

type Input = Record<string, unknown>;

export type AssistantTool = {
  definition: Anthropic.Beta.BetaTool;
  /** What the chat shows while the tool runs. */
  status: string;
  run: (input: Input, ctx: ToolContext) => Promise<unknown> | unknown;
};

export type ToolContext = {
  /** Today in the user's local calendar, YYYY-MM-DD. */
  today: string;
};

// ── input helpers ─────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateArg(input: Input, key: string, fallback: string): string {
  const v = input[key];
  if (v == null || v === "") return fallback;
  if (typeof v !== "string" || !ISO_DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new ToolInputError(`${key} must be a date in YYYY-MM-DD form.`);
  }
  return v;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function range(input: Input, ctx: ToolContext, defaultDays: number): { from: string; to: string } {
  const to = dateArg(input, "end_date", ctx.today);
  const from = dateArg(input, "start_date", addDays(to, -defaultDays));
  if (from > to) throw new ToolInputError("start_date must be on or before end_date.");
  return { from, to };
}

function intArg(input: Input, key: string, fallback: number, min: number, max: number): number {
  const v = input[key];
  if (v == null) return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ToolInputError(`${key} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

function numArg(input: Input, key: string): number | undefined {
  const v = input[key];
  if (v == null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new ToolInputError(`${key} must be a positive number.`);
  }
  return n;
}

function strArg(input: Input, key: string, max = 100): string | undefined {
  const v = input[key];
  if (v == null || v === "") return undefined;
  if (typeof v !== "string") throw new ToolInputError(`${key} must be a string.`);
  return v.trim().slice(0, max) || undefined;
}

function granularityArg(input: Input, fallback: Granularity): Granularity {
  const v = input.granularity;
  if (v == null) return fallback;
  if (v === "day" || v === "week" || v === "month") return v;
  throw new ToolInputError("granularity must be day, week or month.");
}

/** Resolve a name the model typed to one row: exact (case-insensitive), else a unique partial match. */
function resolveByName<T extends { id: string; name: string }>(
  rows: T[],
  name: string,
  what: string,
): T {
  const q = name.toLowerCase();
  const exact = rows.filter((r) => r.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const partial = rows.filter((r) => r.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  const names = (partial.length > 1 ? partial : rows).map((r) => r.name).slice(0, 60);
  throw new ToolInputError(
    `${partial.length > 1 ? `"${name}" matches several ${what}s` : `No ${what} named "${name}"`}. Known ${what}s: ${names.join(", ")}.`,
  );
}

const cents = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);

// ── schema fragments ──────────────────────────────────────────────────────

const DATE_PROPS = {
  start_date: { type: "string", description: "Inclusive start, YYYY-MM-DD." },
  end_date: { type: "string", description: "Inclusive end, YYYY-MM-DD. Defaults to today." },
} as const;

const GRANULARITY_PROP = {
  type: "string",
  enum: ["day", "week", "month"],
  description: "Bucket size. Weeks start on Monday.",
} as const;

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): Anthropic.Beta.BetaTool {
  return {
    name,
    description,
    // Streamed requests with client tools stream tool input as it's generated;
    // every input is validated here before anything runs.
    eager_input_streaming: true,
    input_schema: { type: "object", properties, required },
  };
}

// ── the tools ─────────────────────────────────────────────────────────────

export const TOOLS: AssistantTool[] = [
  {
    status: "Checking your accounts",
    definition: tool(
      "get_accounts",
      "List the user's accounts with current balances, plus total assets, liabilities and net worth (including manual and imported holdings). Credit and loan balances are amounts owed. Accounts the user hid from budgetr are left out.",
    ),
    async run() {
      const accounts = getAccounts()
        .filter((a) => !a.excluded)
        .map((a) => ({
          name: a.name,
          institution: a.institutionName ?? null,
          type: a.type,
          subtype: a.subtype,
          balance: cents(a.currentBalance),
          currency: a.currency ?? "USD",
        }));
      const { nw } = await loadInclusiveNetWorth();
      return {
        accounts,
        assets: cents(nw.assets),
        liabilities: cents(nw.liabilities),
        net_worth: cents(nw.net),
      };
    },
  },
  {
    status: "Looking at your net worth history",
    definition: tool(
      "get_net_worth_history",
      "Net worth over time, one value per period (the last known value in each period). History starts when the user first synced.",
      { ...DATE_PROPS, granularity: GRANULARITY_PROP },
    ),
    async run(input, ctx) {
      const { from, to } = range(input, ctx, 365);
      let g = granularityArg(input, "month");
      const { series } = await loadInclusiveNetWorth();
      const inRange = series.filter((p) => p.date >= from && p.date <= to);
      let points = lastPerBucket(inRange, g);
      if (points.length > 120 && g !== "month") {
        g = g === "day" ? "week" : "month";
        points = lastPerBucket(inRange, g);
        if (points.length > 120) points = lastPerBucket(inRange, (g = "month"));
      }
      return {
        granularity: g,
        first_available: series[0]?.date ?? null,
        points: points.map((p) => ({ date: p.date, net_worth: cents(p.netWorth) })),
      };
    },
  },
  {
    status: "Adding up spending by category",
    definition: tool(
      "get_spending_by_category",
      "Total spending per category between two dates. Transfers between the user's own accounts and card payments are excluded. Defaults to the last 30 days.",
      { ...DATE_PROPS, limit: { type: "integer", description: "Max categories (default 15)." } },
    ),
    run(input, ctx) {
      const { from, to } = range(input, ctx, 30);
      const limit = intArg(input, "limit", 15, 1, 40);
      const all = spendingByCategory(from, to);
      const top = all.slice(0, limit);
      const rest = all.slice(limit);
      return {
        start_date: from,
        end_date: to,
        total_spent: cents(all.reduce((s, c) => s + c.spent, 0)),
        categories: top,
        other_categories:
          rest.length > 0
            ? { count: rest.length, spent: cents(rest.reduce((s, c) => s + c.spent, 0)) }
            : null,
      };
    },
  },
  {
    status: "Charting income and spending",
    definition: tool(
      "get_cashflow_over_time",
      "Spending and income per day, week or month between two dates. Pass a category name to see only that category over time. Transfers are excluded.",
      {
        ...DATE_PROPS,
        granularity: GRANULARITY_PROP,
        category: { type: "string", description: "Optional category name, e.g. 'Dining'." },
      },
    ),
    run(input, ctx) {
      const { from, to } = range(input, ctx, 180);
      const g = granularityArg(input, "month");
      const categoryName = strArg(input, "category");
      const category = categoryName ? resolveByName(getCategories(), categoryName, "category") : null;
      const points = cashflowOverTime(from, to, g, category?.id);
      if (points.length > 200) {
        throw new ToolInputError("That's more than 200 periods; use a coarser granularity or a shorter range.");
      }
      return {
        start_date: from,
        end_date: to,
        granularity: g,
        category: category?.name ?? null,
        periods: points,
      };
    },
  },
  {
    status: "Checking your budgets",
    definition: tool(
      "get_budgets",
      "This budget month's spending per spending category against the monthly budget the user set (budget is null where none is set).",
    ),
    run() {
      const month = getBudgetMonth();
      const rows = getBudgetsWithSpend();
      return {
        month,
        categories: rows.map((r) => ({
          category: r.name,
          budget: cents(r.budget),
          spent: cents(r.spent),
          remaining: cents(r.remaining),
        })),
      };
    },
  },
  {
    status: "Searching your transactions",
    definition: tool(
      "search_transactions",
      "Find transactions and total them. Every filter is optional. Returns totals over all matches plus the most recent matching rows. Positive amounts are money spent, negative amounts are money received.",
      {
        query: { type: "string", description: "Text to match in the merchant or description." },
        category: { type: "string", description: "Category name." },
        account: { type: "string", description: "Account name." },
        ...DATE_PROPS,
        min_amount: { type: "number", description: "Minimum absolute amount." },
        max_amount: { type: "number", description: "Maximum absolute amount." },
        limit: { type: "integer", description: "Rows to return (default 20, max 50)." },
      },
    ),
    run(input) {
      const criteria: TxnCriteria = {};
      const q = strArg(input, "query");
      if (q) criteria.q = q;
      const cat = strArg(input, "category");
      if (cat) criteria.categoryId = resolveByName(getCategories(), cat, "category").id;
      const acct = strArg(input, "account");
      if (acct) {
        const accounts = getAccounts().filter((a) => !a.excluded);
        criteria.accountId = resolveByName(accounts, acct, "account").id;
      }
      const start = input.start_date == null ? undefined : dateArg(input, "start_date", "");
      const end = input.end_date == null ? undefined : dateArg(input, "end_date", "");
      if (start) criteria.dateFrom = start;
      if (end) criteria.dateTo = end;
      criteria.amountMin = numArg(input, "min_amount");
      criteria.amountMax = numArg(input, "max_amount");
      const limit = intArg(input, "limit", 20, 1, 50);

      const s = summarizeTransactions(criteria);
      const rows = searchTransactions(criteria, limit).map((t) => ({
        date: t.date,
        merchant: t.displayName,
        amount: cents(t.amount),
        currency: t.currency ?? "USD",
        category: t.categoryName,
        account: t.accountName,
        pending: t.pending || undefined,
        transfer: t.isTransfer || undefined,
      }));
      return {
        matches: s.total,
        spent: cents(s.spent),
        received: cents(s.received),
        transferred: cents(s.transferred),
        first_date: s.firstDate,
        last_date: s.lastDate,
        rows,
        rows_truncated: s.total > rows.length,
      };
    },
  },
  {
    status: "Finding your top merchants",
    definition: tool(
      "get_top_merchants",
      "The merchants the user spent the most with between two dates. Defaults to the last 90 days.",
      { ...DATE_PROPS, limit: { type: "integer", description: "How many (default 10, max 25)." } },
    ),
    run(input, ctx) {
      const { from, to } = range(input, ctx, 90);
      const limit = intArg(input, "limit", 10, 1, 25);
      return { start_date: from, end_date: to, merchants: topMerchants(from, to, limit) };
    },
  },
  {
    status: "Looking at your investments",
    definition: tool(
      "get_holdings",
      "Investment holdings: linked brokerage positions with their value, and positions rebuilt from imported trades (quantity and cost basis only).",
    ),
    run() {
      const linked = getHoldings().map((h) => ({
        ticker: h.ticker,
        name: h.securityName,
        type: h.securityType,
        account: h.accountName,
        quantity: h.quantity,
        value: cents(h.value),
        cost_basis: cents(h.costBasis),
        currency: h.currency ?? "USD",
      }));
      const imported = getImportedHoldings().map((h) => ({
        ticker: h.ticker,
        name: h.securityName,
        account: h.accountName,
        quantity: h.quantity,
        cost_basis: cents(h.costBasis),
        currency: h.currency ?? "USD",
      }));
      return {
        linked,
        imported,
        linked_total_value: cents(linked.reduce((s, h) => s + (h.value ?? 0), 0)),
      };
    },
  },
  {
    status: "Checking recurring bills and income",
    definition: tool(
      "get_recurring",
      "Active recurring charges and income (subscriptions, bills, paychecks) with their typical amount, frequency and next expected date.",
    ),
    run() {
      return getRecurringStreams().map((r) => ({
        name: r.userLabel || r.merchantName || r.description,
        direction: r.direction === "inflow" ? "income" : "charge",
        frequency: r.frequency,
        average_amount: cents(r.averageAmount == null ? null : Math.abs(r.averageAmount)),
        last_date: r.lastDate,
        next_expected: r.predictedNextDate,
        category: r.category,
        currency: r.currency ?? "USD",
      }));
    },
  },
  {
    status: "Checking your categories",
    definition: tool(
      "list_categories",
      "The user's categories and the group each belongs to (spending, income or transfer).",
    ),
    run() {
      return getCategories().map((c) => ({ name: c.name, group: c.group }));
    },
  },
];

/** The render_chart tool definition. Its "run" lives in the loop, which owns the chart events. */
export const RENDER_CHART_TOOL: Anthropic.Beta.BetaTool = {
  name: RENDER_CHART,
  description:
    "Show the user a chart or table inline in the chat, drawn from data you already fetched with the other tools. Use it whenever a visual makes the answer clearer: a trend, a comparison, a breakdown. Only plot numbers that came from tool results.",
  eager_input_streaming: true,
  input_schema: CHART_INPUT_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema,
};

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  ...TOOLS.map((t) => t.definition),
  RENDER_CHART_TOOL,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.definition.name, t]));

export function findTool(name: string): AssistantTool | undefined {
  return BY_NAME.get(name);
}

/** Run a data tool. Returns the JSON string for the tool_result, or throws. */
export async function runDataTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const t = findTool(name);
  if (!t) throw new ToolInputError(`Unknown tool ${name}.`);
  const obj = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Input) : null;
  if (!obj) throw new ToolInputError("Tool input must be an object.");
  const result = await t.run(obj, ctx);
  return JSON.stringify(result);
}

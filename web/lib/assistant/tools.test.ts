// The assistant's read-only data tools, run against the in-memory DEMO_DB
// schema. The env var must be set before @/db is first imported, hence the
// dynamic imports (same pattern as lib/companion/companion.test.ts).

process.env.DEMO_DB = "1";

import { beforeAll, describe, expect, it } from "vitest";

let tools: typeof import("./tools");
let queries: typeof import("./queries");

const ctx = { today: "2026-03-31" };

async function run(name: string, input: unknown = {}) {
  return JSON.parse(await tools.runDataTool(name, input, ctx));
}

beforeAll(async () => {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  tools = await import("./tools");
  queries = await import("./queries");

  const ts = new Date("2026-03-31T12:00:00Z");
  db.insert(schema.items)
    .values({ id: "item-1", accessToken: "manual", source: "manual", createdAt: ts, updatedAt: ts })
    .run();
  db.insert(schema.accounts)
    .values([
      { id: "acc-chk", itemId: "item-1", source: "manual", name: "Everyday Checking", type: "depository", currentBalance: 3000.5, mask: "1234", updatedAt: ts },
      { id: "acc-cc", itemId: "item-1", source: "manual", name: "Visa", type: "credit", currentBalance: 500.25, updatedAt: ts },
      { id: "acc-hidden", itemId: "item-1", source: "manual", name: "Secret Savings", type: "depository", currentBalance: 99999, excluded: true, updatedAt: ts },
    ])
    .run();
  db.insert(schema.categories)
    .values([
      { id: "cat_dining", name: "Dining", group: "spending" },
      { id: "cat_groceries", name: "Groceries", group: "spending" },
      { id: "cat_gas", name: "Gas & Fuel", group: "spending" },
      { id: "cat_xfer", name: "Transfer", group: "transfer" },
      { id: "cat_pay", name: "Paycheck", group: "income" },
    ])
    .run();
  db.insert(schema.budgets).values({ id: "b1", categoryId: "cat_dining", amount: 500 }).run();

  const t = (id: string, date: string, amount: number, name: string, cat: string | null, extra = {}) => ({
    id,
    accountId: "acc-chk",
    amount,
    date,
    name,
    merchantName: name,
    pending: false,
    userCategoryId: cat,
    ...extra,
  });
  db.insert(schema.transactions)
    .values([
      t("d1", "2026-01-10", 40, "Cafe Zoe", "cat_dining", { notes: "date night with A." }),
      t("d2", "2026-02-12", 60, "Cafe Zoe", "cat_dining"),
      t("d3", "2026-03-05", 25.5, "Noodle Bar", "cat_dining"),
      t("g1", "2026-03-06", 120, "Fresh Market", "cat_groceries"),
      t("g2", "2026-03-20", 80, "Fresh Market", "cat_groceries"),
      t("x1", "2026-03-15", 1000, "Transfer to savings", "cat_xfer"),
      t("p1", "2026-03-01", -2500, "Payroll", "cat_pay"),
      t("pend", "2026-03-30", 999, "Pending thing", "cat_dining", { pending: true }),
      t("old", "2025-06-01", 70, "Cafe Zoe", "cat_dining"),
    ])
    .run();
});

describe("tool definitions", () => {
  it("every tool has an object schema, streams input eagerly, and a unique name", () => {
    const names = tools.TOOL_DEFINITIONS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain(tools.RENDER_CHART);
    for (const d of tools.TOOL_DEFINITIONS) {
      expect(d.input_schema.type).toBe("object");
      expect(d.eager_input_streaming).toBe(true);
      expect(d.description?.length).toBeGreaterThan(20);
    }
  });
});

describe("get_accounts", () => {
  it("leaves out hidden accounts and never returns masks or ids", async () => {
    const r = await run("get_accounts");
    const names = r.accounts.map((a: { name: string }) => a.name);
    expect(names).toEqual(expect.arrayContaining(["Everyday Checking", "Visa"]));
    expect(names).not.toContain("Secret Savings");
    const json = JSON.stringify(r);
    expect(json).not.toContain("1234");
    expect(json).not.toContain("acc-chk");
    expect(typeof r.net_worth).toBe("number");
  });
});

describe("get_spending_by_category", () => {
  it("totals settled spending in range, excluding transfers and income", async () => {
    const r = await run("get_spending_by_category", { start_date: "2026-03-01", end_date: "2026-03-31" });
    expect(r.categories).toEqual([
      { category: "Groceries", group: "spending", spent: 200, transactions: 2 },
      { category: "Dining", group: "spending", spent: 25.5, transactions: 1 },
    ]);
    expect(r.total_spent).toBe(225.5);
    expect(r.other_categories).toBeNull();
  });

  it("defaults to the last 30 days and groups the rest past the limit", async () => {
    const r = await run("get_spending_by_category", { limit: 1 });
    expect(r.start_date).toBe("2026-03-01");
    expect(r.end_date).toBe("2026-03-31");
    expect(r.categories).toHaveLength(1);
    expect(r.other_categories).toEqual({ count: 1, spent: 25.5 });
  });

  it("rejects bad dates and ranges with a message Claude can act on", async () => {
    await expect(run("get_spending_by_category", { start_date: "March 1" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(run("get_spending_by_category", { start_date: "2026-02-30x" })).rejects.toBeInstanceOf(tools.ToolInputError);
    await expect(
      run("get_spending_by_category", { start_date: "2026-04-01", end_date: "2026-03-01" }),
    ).rejects.toThrow(/on or before/);
    await expect(run("get_spending_by_category", { limit: 0 })).rejects.toThrow(/whole number/);
  });
});

describe("get_cashflow_over_time", () => {
  it("buckets spending and income by month", async () => {
    const r = await run("get_cashflow_over_time", { start_date: "2026-01-01", end_date: "2026-03-31" });
    expect(r.periods).toEqual([
      { period: "2026-01", spent: 40, income: 0 },
      { period: "2026-02", spent: 60, income: 0 },
      { period: "2026-03", spent: 225.5, income: 2500 },
    ]);
  });

  it("filters to one category resolved by partial name", async () => {
    const r = await run("get_cashflow_over_time", {
      start_date: "2025-01-01",
      end_date: "2026-03-31",
      category: "dIn",
    });
    expect(r.category).toBe("Dining");
    expect(r.periods.map((p: { period: string }) => p.period)).toEqual(["2025-06", "2026-01", "2026-02", "2026-03"]);
  });

  it("buckets weeks from Monday", async () => {
    const r = await run("get_cashflow_over_time", {
      start_date: "2026-03-01",
      end_date: "2026-03-31",
      granularity: "week",
      category: "Groceries",
    });
    // Fri 6 Mar → week of Mon 2 Mar; Fri 20 Mar → week of Mon 16 Mar.
    expect(r.periods).toEqual([
      { period: "2026-03-02", spent: 120, income: 0 },
      { period: "2026-03-16", spent: 80, income: 0 },
    ]);
  });

  it("names the known categories when the name doesn't match", async () => {
    await expect(run("get_cashflow_over_time", { category: "Rent" })).rejects.toThrow(/No category named "Rent".*Dining/);
    await expect(run("get_cashflow_over_time", { granularity: "year" })).rejects.toThrow(/day, week or month/);
  });
});

describe("search_transactions", () => {
  it("totals matches and returns rows without notes or ids", async () => {
    const r = await run("search_transactions", { query: "Cafe Zoe" });
    expect(r.matches).toBe(3);
    expect(r.spent).toBe(170);
    expect(r.rows[0]).toMatchObject({ date: "2026-02-12", amount: 60, category: "Dining", account: "Everyday Checking" });
    const json = JSON.stringify(r);
    expect(json).not.toContain("date night");
    expect(json).not.toContain('"d1"');
  });

  it("filters by category, account, dates and amount", async () => {
    const r = await run("search_transactions", {
      category: "Groceries",
      account: "checking",
      start_date: "2026-03-10",
      min_amount: 50,
    });
    expect(r.rows.map((x: { amount: number }) => x.amount)).toEqual([80]);
  });

  it("won't resolve a hidden account", async () => {
    await expect(run("search_transactions", { account: "Secret" })).rejects.toThrow(/No account named/);
  });

  it("caps the row count", async () => {
    await expect(run("search_transactions", { limit: 500 })).rejects.toThrow(/1 to 50/);
    const r = await run("search_transactions", { limit: 2 });
    expect(r.rows).toHaveLength(2);
    expect(r.rows_truncated).toBe(true);
  });
});

describe("get_top_merchants", () => {
  it("ranks merchants by spend, excluding transfers and pending", async () => {
    const r = await run("get_top_merchants", { start_date: "2026-01-01", end_date: "2026-03-31" });
    expect(r.merchants.map((m: { merchant: string }) => m.merchant)).not.toContain("Transfer to savings");
    expect(r.merchants[0]).toMatchObject({ spent: 200, transactions: 2 });
    expect(JSON.stringify(r)).not.toContain("Pending thing");
  });
});

describe("other tools", () => {
  it("lists categories by name and group only", async () => {
    const r = await run("list_categories");
    expect(r).toContainEqual({ name: "Dining", group: "spending" });
    expect(JSON.stringify(r)).not.toContain("cat_");
  });

  it("returns budgets, holdings and recurring without throwing", async () => {
    const b = await run("get_budgets");
    expect(b.categories).toContainEqual(expect.objectContaining({ category: "Dining", budget: 500 }));
    const h = await run("get_holdings");
    expect(h).toMatchObject({ linked: [], imported: [], linked_total_value: 0 });
    expect(Array.isArray(await run("get_recurring"))).toBe(true);
    const nw = await run("get_net_worth_history");
    expect(nw.granularity).toBe("month");
  });

  it("rejects unknown tools and non-object input", async () => {
    await expect(tools.runDataTool("drop_tables", {}, ctx)).rejects.toThrow(/Unknown tool/);
    await expect(tools.runDataTool("get_accounts", "x", ctx)).rejects.toThrow(/must be an object/);
    await expect(tools.runDataTool("get_accounts", [1], ctx)).rejects.toThrow(/must be an object/);
  });
});

describe("lastPerBucket", () => {
  const pts = [
    { date: "2026-03-01", v: 1 },
    { date: "2026-03-02", v: 2 }, // Monday
    { date: "2026-03-08", v: 3 }, // Sunday
    { date: "2026-03-09", v: 4 }, // Monday
    { date: "2026-04-01", v: 5 },
  ];
  it("keeps the last point per month and per Monday-week", () => {
    expect(queries.lastPerBucket(pts, "month").map((p) => p.v)).toEqual([4, 5]);
    expect(queries.lastPerBucket(pts, "week").map((p) => p.v)).toEqual([1, 3, 4, 5]);
    expect(queries.lastPerBucket(pts, "day")).toBe(pts);
  });
});

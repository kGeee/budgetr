// T4 acceptance tests (companion spec §7):
//  - read-model → buildSummary produces a valid, correctly-signed Summary
//  - replaying an outbox batch applies exactly once
//  - ops referencing deleted rows are acked without erroring
//  - dismissAlert lands in dismissed_alerts exactly like the UI action
//
// Runs against the in-memory DEMO_DB schema (db/demo-schema.ts) — the env var
// must be set before @/db is first imported, hence the dynamic imports.

process.env.DEMO_DB = "1";

import { beforeAll, describe, expect, it } from "vitest";

let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let buildReadModel: typeof import("./read-model").buildReadModel;
let applyOps: typeof import("./ops").applyOps;
let store: typeof import("./store");
let core: typeof import("@budgetr/core");

const NOW = 1_784_600_000;

beforeAll(async () => {
  ({ db } = await import("@/db"));
  schema = await import("@/db/schema");
  ({ buildReadModel } = await import("./read-model"));
  ({ applyOps } = await import("./ops"));
  store = await import("./store");
  core = await import("@budgetr/core");

  const ts = new Date(NOW * 1000);
  db.insert(schema.items)
    .values({ id: "item-1", accessToken: "manual", source: "manual", createdAt: ts, updatedAt: ts })
    .run();
  db.insert(schema.accounts)
    .values([
      { id: "acc-chk", itemId: "item-1", source: "manual", name: "Checking", type: "depository", currentBalance: 3000.5, updatedAt: ts },
      { id: "acc-cc", itemId: "item-1", source: "manual", name: "Visa", type: "credit", currentBalance: 500.25, updatedAt: ts },
      { id: "acc-hidden", itemId: "item-1", source: "manual", name: "Hidden", type: "depository", currentBalance: 99999, excluded: true, updatedAt: ts },
    ])
    .run();
  db.insert(schema.categories)
    .values([
      { id: "cat_dining", name: "Dining", group: "spending" },
      { id: "cat_groceries", name: "Groceries", group: "spending" },
    ])
    .run();
  db.insert(schema.budgets).values({ id: "b1", categoryId: "cat_dining", amount: 500 }).run();
  db.insert(schema.transactions)
    .values([
      {
        id: "txn-1",
        accountId: "acc-chk",
        amount: 12.5, // Plaid-positive = outflow
        date: new Date().toISOString().slice(0, 10), // current month → counts into the budget month
        name: "CAFE ZOE",
        merchantName: "Café Zoë",
        pending: false,
        userCategoryId: "cat_dining",
      },
      {
        id: "txn-2",
        accountId: "acc-chk",
        amount: -2000, // inflow
        date: new Date().toISOString().slice(0, 10),
        name: "PAYROLL",
        pending: false,
      },
    ])
    .run();
});

describe("read-model → buildSummary", () => {
  it("produces a valid Summary with correct signs, cents, and budget state", () => {
    const summary = core.buildSummary(buildReadModel(NOW));
    core.assertValidSummary(summary);

    const chk = summary.accounts.find((a) => a.id === "acc-chk")!;
    const cc = summary.accounts.find((a) => a.id === "acc-cc")!;
    expect(chk.cents).toBe(300_050);
    expect(cc.cents).toBe(-50_025); // liability → negative
    expect(summary.accounts.find((a) => a.id === "acc-hidden")).toBeUndefined(); // excluded stays home

    const outflow = summary.recent.find((t) => t.id === "txn-1")!;
    const inflow = summary.recent.find((t) => t.id === "txn-2")!;
    expect(outflow.cents).toBe(-1_250); // Plaid-positive outflow → contract-negative
    expect(outflow.merchant).toBe("Café Zoë");
    expect(inflow.cents).toBe(200_000);

    const dining = summary.budgets.find((b) => b.category === "cat_dining")!;
    expect(dining.limitCents).toBe(50_000);
    expect(dining.spentCents).toBe(1_250);
    expect(dining.state).toBe("ok");

    // net worth: 3000.50 − 500.25 (hidden account excluded)
    expect(summary.netWorth.cents).toBe(250_025);

    // the category vocabulary ships with real display names
    const dining2 = summary.categories!.find((c) => c.id === "cat_dining")!;
    expect(dining2.name).toBe("Dining");
    expect(dining2.group).toBe("spending");
  });
});

describe("applyOps", () => {
  it("applies a recategorize once; replaying the same batch is a no-op", () => {
    const ops: import("@budgetr/core").Op[] = [
      { id: "op-recat-1", ts: NOW, kind: "recategorize", txnId: "txn-1", toCategory: "cat_groceries" },
    ];
    expect(applyOps(ops).mutated).toBe(1);

    const row = db
      .select({ cat: schema.transactions.userCategoryId, reviewed: schema.transactions.reviewed })
      .from(schema.transactions)
      .all()
      .find((r) => r.cat === "cat_groceries");
    expect(row?.reviewed).toBe(true);

    // replay → zero mutations, id remembered
    expect(applyOps(ops).mutated).toBe(0);
    expect(store.getAppliedOpIds()).toContain("op-recat-1");
  });

  it("acks ops whose targets vanished without erroring the batch", () => {
    const ops: import("@budgetr/core").Op[] = [
      { id: "op-gone-txn", ts: NOW, kind: "recategorize", txnId: "txn-deleted", toCategory: "cat_dining" },
      { id: "op-gone-cat", ts: NOW, kind: "recategorize", txnId: "txn-1", toCategory: "cat_deleted" },
    ];
    expect(applyOps(ops).mutated).toBe(0);
    expect(store.getAppliedOpIds()).toEqual(expect.arrayContaining(["op-gone-txn", "op-gone-cat"]));
  });

  it("dismissAlert writes dismissed_alerts keyed by alertKey, idempotently", () => {
    const ops: import("@budgetr/core").Op[] = [
      { id: "op-dismiss-1", ts: NOW, kind: "dismissAlert", alertId: "spike:Some Vendor" },
    ];
    expect(applyOps(ops).mutated).toBe(1);
    expect(applyOps(ops).mutated).toBe(0); // replay

    const rows = db.select().from(schema.dismissedAlerts).all();
    expect(rows.filter((r) => r.alertKey === "spike:Some Vendor")).toHaveLength(1);
  });

  it("appliedOpIds land in the next summary so the phone can clear its outbox", () => {
    const summary = core.buildSummary(buildReadModel(NOW));
    expect(summary.appliedOpIds).toEqual(expect.arrayContaining(["op-recat-1", "op-dismiss-1"]));
  });
});

describe("pairing store", () => {
  it("save/load/clear round-trips and wipes all companion state", () => {
    store.savePairing({ relayUrl: "https://r.example", channelId: "ch_x", channelToken: "tok_x", syncKey: "a".repeat(44) });
    store.setLastSeq(7);
    expect(store.loadPairing()?.channelId).toBe("ch_x");
    expect(store.getSyncStatus().paired).toBe(true);

    store.clearPairing();
    expect(store.loadPairing()).toBeNull();
    expect(store.getLastSeq()).toBe(0);
    expect(store.getAppliedOpIds()).toEqual([]);
  });
});

describe("investments read-model", () => {
  it("builds spark, sectors, and options strategies from holdings", async () => {
    const ts = new Date(NOW * 1000);
    db.insert(schema.accounts)
      .values({ id: "acc-brokerage", itemId: "item-1", source: "manual", name: "Brokerage", type: "investment", currentBalance: 20000, updatedAt: ts })
      .run();
    db.insert(schema.securities)
      .values([
        { id: "sec-voo", tickerSymbol: "VOO", name: "Vanguard S&P 500", type: "etf" },
        // bull call spread on AAPL: long 190C / short 200C, same expiry
        { id: "sec-c190", tickerSymbol: "AAPL260918C00190000", name: "AAPL Call 190", type: "derivative" },
        { id: "sec-c200", tickerSymbol: "AAPL260918C00200000", name: "AAPL Call 200", type: "derivative" },
      ])
      .run();
    db.insert(schema.holdings)
      .values([
        { id: "acc-brokerage:sec-voo", accountId: "acc-brokerage", securityId: "sec-voo", quantity: 30, institutionValue: 15000, updatedAt: ts },
        { id: "acc-brokerage:sec-c190", accountId: "acc-brokerage", securityId: "sec-c190", quantity: 100, institutionValue: 1200, costBasis: 900, updatedAt: ts },
        { id: "acc-brokerage:sec-c200", accountId: "acc-brokerage", securityId: "sec-c200", quantity: -100, institutionValue: -400, costBasis: -300, updatedAt: ts },
      ])
      .run();
    db.insert(schema.investmentSectors)
      .values([
        { sectorKey: "sym:VOO", sector: "Broad Market" },
        { sectorKey: "sym:AAPL", sector: "Technology" },
      ])
      .run();
    db.insert(schema.balanceSnapshots)
      .values([
        { accountId: "acc-brokerage", date: "2026-07-19", balance: 19000, type: "investment" },
        { accountId: "acc-brokerage", date: "2026-07-20", balance: 20000, type: "investment" },
      ])
      .run();

    const summary = core.buildSummary(buildReadModel(NOW));
    core.assertValidSummary(summary);
    const inv = summary.investments!;

    expect(inv.valueCents).toBe(1_580_000); // 15000 + 1200 - 400 dollars → cents
    expect(inv.spark.map((p) => p.cents)).toEqual([1_900_000, 2_000_000]);

    const sectorMap = Object.fromEntries(inv.sectors.map((sl) => [sl.sector, sl.cents]));
    expect(sectorMap["Broad Market"]).toBe(1_500_000);
    expect(sectorMap["Technology"]).toBe(80_000); // both option legs under AAPL

    expect(inv.strategies).toHaveLength(1);
    const st = inv.strategies[0]!;
    expect(st.underlying).toBe("AAPL");
    expect(st.label).toBe("Bull call spread");
    expect(st.cents).toBe(80_000);
    expect(Object.keys(st).sort()).toEqual([
      "breakevens", "cents", "curve", "detail", "expiry", "id", "label", "maxLossCents", "maxProfitCents", "underlying",
    ]);
    // pre-rendered payoff: ascending integer-cent vertices, real breakevens
    expect(st.curve!.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < st.curve!.length; i++) expect(st.curve![i]!.p).toBeGreaterThan(st.curve![i - 1]!.p);
    for (const v of st.curve!) {
      expect(Number.isSafeInteger(v.p)).toBe(true);
      expect(Number.isSafeInteger(v.pnl)).toBe(true);
    }
    expect(st.breakevens!.length).toBeGreaterThan(0);

    // option legs fold into their underlying in positions
    const aapl = summary.positions.find((p) => p.symbol === "AAPL")!;
    expect(aapl.cents).toBe(80_000);
    expect(aapl.pnlCents).toBe(20_000); // (1200-900) + (-400-(-300)) dollars
    expect(aapl.qtyLabel).toBeUndefined(); // options in the mix — no share count
    const voo = summary.positions.find((p) => p.symbol === "VOO")!;
    expect(voo.name).toBe("Vanguard S&P 500");
    expect(voo.qtyLabel).toBe("30");
    expect(voo.sector).toBe("Broad Market");
    expect(voo.pnlCents).toBeUndefined(); // no basis recorded — never fake P&L
    expect(summary.positions.some((p) => p.symbol.includes("C00190000"))).toBe(false);
  });
});

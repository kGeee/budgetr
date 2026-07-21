/**
 * The comprehensive FAKE demo dataset ("Jordan Lee", net worth ~$300k) and the
 * machinery to load/clear it in-app.
 *
 * Why this lives in lib/ (not just scripts/): a brand-new install seeds this data
 * automatically so the very first thing a user sees is a fully populated,
 * explorable dashboard — not an empty shell or a keys form. When they're ready to
 * connect real accounts, `wipeFinancialData()` clears it (single-user local app,
 * so a clean reset is safe) and `setDemoMode(false)` flips the flag.
 *
 * scripts/seed-demo.ts is a thin CLI wrapper over `seedDemoData()` (used to
 * generate the marketing screenshots against a scratch DB). Server-only — imports
 * the DB; never import from a client component.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  allocationTargets,
  balanceSnapshots,
  budgets,
  categories,
  dashboards,
  dashboardWidgets,
  expenseShares,
  fireSettings,
  holdings,
  investmentGeographies,
  investmentTransactions,
  items,
  manualHoldings,
  netWorthMilestones,
  people,
  recurringStreams,
  savingsContributions,
  savingsGoals,
  securities,
  settlements,
  sharedExpenses,
  tagRules,
  tags,
  transactionMatches,
  transactionSplits,
  transactionTags,
  transactions,
  vendorGroupMembers,
  vendorGroups,
} from "@/db/schema";
import { REIMBURSABLE_CATEGORY_ID, seedCategories } from "@/lib/seed-categories-data";
import { isFirstRunDone, markFirstRunDone, setDemoMode } from "@/lib/app-config";
import { hasPlaidCredentials } from "@/lib/plaid";

/**
 * Wipe every financial table (children → parents), leaving categories, app
 * settings (Plaid keys, flags) and other config intact. Shared by the demo seed
 * (which reinserts) and the "exit demo" flow (which stops here).
 */
export function wipeFinancialData(): void {
  // Newer overlays first (child → parent). Most would cascade from the
  // transactions/accounts/people deletes below, but deleting explicitly keeps
  // this correct regardless of FK-cascade state and makes the coverage obvious.
  db.delete(transactionSplits).run();
  db.delete(expenseShares).run();
  db.delete(settlements).run();
  db.delete(sharedExpenses).run();
  db.delete(people).run();
  db.delete(transactionMatches).run();
  db.delete(transactionTags).run();
  db.delete(tagRules).run();
  db.delete(tags).run();
  db.delete(vendorGroupMembers).run();
  db.delete(vendorGroups).run();
  db.delete(recurringStreams).run();
  db.delete(dashboardWidgets).run();
  db.delete(dashboards).run();
  db.delete(allocationTargets).run();
  db.delete(investmentGeographies).run();

  db.delete(savingsContributions).run();
  db.delete(savingsGoals).run();
  db.delete(netWorthMilestones).run();
  db.delete(investmentTransactions).run();
  db.delete(holdings).run();
  db.delete(securities).run();
  db.delete(manualHoldings).run();
  db.delete(balanceSnapshots).run();
  db.delete(transactions).run();
  db.delete(budgets).run();
  db.delete(fireSettings).run();
  db.delete(accounts).run();
  db.delete(items).run();
}

/**
 * Seed the full demo dataset. Idempotent: wipes the financial tables it owns,
 * ensures categories exist (budgets attach to them), then reinserts. Uses a
 * deterministic PRNG so successive runs produce identical data.
 */
export function seedDemoData(): { transactions: number; budgets: number } {
  // ── Deterministic PRNG (reset per call so runs are identical) ──────────────
  let _seed = 1337;
  const rand = (): number => {
    _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
    return _seed / 0x7fffffff;
  };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const money = (lo: number, hi: number) => Math.round(between(lo, hi) * 100) / 100;

  const NOW = new Date();
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  const daysAgo = (n: number): string => {
    const d = new Date(NOW);
    d.setDate(d.getDate() - n);
    return iso(d);
  };

  const CHECKING = "acc_checking";
  const SAVINGS = "acc_savings";
  const CREDIT = "acc_credit";
  const BROKERAGE = "acc_brokerage";

  // Categories must exist before budgets can reference them.
  seedCategories();
  wipeFinancialData();

  // ── Accounts + items ───────────────────────────────────────────────────────
  db.insert(items)
    .values([
      { id: "item_northwind", accessToken: "demo", plaidEnv: "production", institutionId: "ins_1", institutionName: "Northwind Bank", status: "active", createdAt: NOW, updatedAt: NOW },
      { id: "item_chase", accessToken: "demo", plaidEnv: "production", institutionId: "ins_2", institutionName: "Chase", status: "active", createdAt: NOW, updatedAt: NOW },
      { id: "item_vanguard", accessToken: "demo", plaidEnv: "production", institutionId: "ins_3", institutionName: "Vanguard", status: "active", createdAt: NOW, updatedAt: NOW },
    ])
    .run();

  db.insert(accounts)
    .values([
      { id: CHECKING, itemId: "item_northwind", name: "Everyday Checking", officialName: "Northwind Everyday Checking", mask: "4021", type: "depository", subtype: "checking", currentBalance: 8420.55, availableBalance: 8420.55, isoCurrencyCode: "USD", updatedAt: NOW },
      { id: SAVINGS, itemId: "item_northwind", name: "High-Yield Savings", officialName: "Northwind HYSA", mask: "8830", type: "depository", subtype: "savings", currentBalance: 46200.0, availableBalance: 46200.0, isoCurrencyCode: "USD", updatedAt: NOW },
      { id: CREDIT, itemId: "item_chase", name: "Sapphire Reserve", officialName: "Chase Sapphire Reserve", mask: "1099", type: "credit", subtype: "credit card", currentBalance: 2150.42, availableBalance: 12849.58, isoCurrencyCode: "USD", updatedAt: NOW },
      { id: BROKERAGE, itemId: "item_vanguard", name: "Brokerage", officialName: "Vanguard Brokerage", mask: "7702", type: "investment", subtype: "brokerage", currentBalance: 214300.0, availableBalance: null, isoCurrencyCode: "USD", updatedAt: NOW },
    ])
    .run();

  // ── Securities + holdings ──────────────────────────────────────────────────
  type Eq = { id: string; ticker: string; name: string; qty: number; close: number; basis: number };
  const EQUITIES: Eq[] = [
    { id: "sec_aapl", ticker: "AAPL", name: "Apple Inc.", qty: 320, close: 235.0, basis: 48000 },
    { id: "sec_msft", ticker: "MSFT", name: "Microsoft Corp.", qty: 90, close: 430.0, basis: 26000 },
    { id: "sec_nvda", ticker: "NVDA", name: "NVIDIA Corp.", qty: 260, close: 128.0, basis: 12000 },
    { id: "sec_voo", ticker: "VOO", name: "Vanguard S&P 500 ETF", qty: 60, close: 540.0, basis: 24000 },
    { id: "sec_vti", ticker: "VTI", name: "Vanguard Total Stock Market ETF", qty: 90, close: 285.0, basis: 20000 },
    { id: "sec_amzn", ticker: "AMZN", name: "Amazon.com Inc.", qty: 40, close: 205.0, basis: 6000 },
    { id: "sec_vxus", ticker: "VXUS", name: "Vanguard Total International Stock ETF", qty: 150, close: 62.0, basis: 8000 },
  ];

  // AAPL call spread ~3 months out (third Friday). OCC: ROOT+YYMMDD+C/P+strike*1000(8).
  const OPT_EXP = (() => {
    const d = new Date(NOW);
    d.setDate(d.getDate() + 90);
    return d;
  })();
  const occ = (right: "C" | "P", strike: number) => {
    const yy = String(OPT_EXP.getFullYear()).slice(2);
    const mm = String(OPT_EXP.getMonth() + 1).padStart(2, "0");
    const dd = String(OPT_EXP.getDate()).padStart(2, "0");
    return `AAPL${yy}${mm}${dd}${right}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
  };
  const LONG_CALL = occ("C", 250);
  const SHORT_CALL = occ("C", 270);

  db.insert(securities)
    .values([
      ...EQUITIES.map((e) => ({ id: e.id, name: e.name, tickerSymbol: e.ticker, type: "equity", closePrice: e.close, isoCurrencyCode: "USD" })),
      { id: "sec_opt_long", name: "AAPL Call $250", tickerSymbol: LONG_CALL, type: "derivative", closePrice: 14.5, isoCurrencyCode: "USD" },
      { id: "sec_opt_short", name: "AAPL Call $270", tickerSymbol: SHORT_CALL, type: "derivative", closePrice: 6.2, isoCurrencyCode: "USD" },
    ])
    .run();

  db.insert(holdings)
    .values([
      ...EQUITIES.map((e) => ({
        id: `${BROKERAGE}:${e.id}`,
        accountId: BROKERAGE,
        securityId: e.id,
        quantity: e.qty,
        costBasis: e.basis,
        institutionPrice: e.close,
        institutionValue: Math.round(e.qty * e.close * 100) / 100,
        isoCurrencyCode: "USD",
        updatedAt: NOW,
      })),
      { id: `${BROKERAGE}:sec_opt_long`, accountId: BROKERAGE, securityId: "sec_opt_long", quantity: 100, costBasis: 1120, institutionPrice: 14.5, institutionValue: 1450, isoCurrencyCode: "USD", updatedAt: NOW },
      { id: `${BROKERAGE}:sec_opt_short`, accountId: BROKERAGE, securityId: "sec_opt_short", quantity: -100, costBasis: -540, institutionPrice: 6.2, institutionValue: -620, isoCurrencyCode: "USD", updatedAt: NOW },
    ])
    .run();

  // Investment ledger: staggered buys, one realized sale, quarterly dividends.
  const inv: (typeof investmentTransactions.$inferInsert)[] = [];
  let k = 0;
  const buy = (secId: string, date: string, qty: number, price: number, name: string) =>
    inv.push({ id: `inv_${k++}`, accountId: BROKERAGE, securityId: secId, date, name, type: "buy", subtype: "buy", quantity: qty, amount: qty * price, price, fees: 0, isoCurrencyCode: "USD" });
  const sell = (secId: string, date: string, qty: number, price: number, name: string) =>
    inv.push({ id: `inv_${k++}`, accountId: BROKERAGE, securityId: secId, date, name, type: "sell", subtype: "sell", quantity: -qty, amount: -qty * price, price, fees: 0, isoCurrencyCode: "USD" });
  const div = (secId: string, date: string, amt: number, name: string) =>
    inv.push({ id: `inv_${k++}`, accountId: BROKERAGE, securityId: secId, date, name, type: "cash", subtype: "dividend", quantity: null, amount: -amt, price: null, fees: 0, isoCurrencyCode: "USD" });

  buy("sec_aapl", daysAgo(680), 400, 150, "Buy AAPL");
  sell("sec_aapl", daysAgo(210), 80, 220, "Sell AAPL");
  buy("sec_msft", daysAgo(600), 90, 289, "Buy MSFT");
  buy("sec_nvda", daysAgo(520), 160, 46, "Buy NVDA");
  buy("sec_nvda", daysAgo(300), 100, 62, "Buy NVDA");
  buy("sec_voo", daysAgo(560), 60, 400, "Buy VOO");
  buy("sec_vti", daysAgo(480), 90, 222, "Buy VTI");
  buy("sec_amzn", daysAgo(410), 40, 150, "Buy AMZN");
  buy("sec_vxus", daysAgo(450), 150, 53.33, "Buy VXUS");
  for (const q of [270, 180, 90]) {
    div("sec_aapl", daysAgo(q), 76.8, "AAPL Dividend");
    div("sec_voo", daysAgo(q), 84.0, "VOO Dividend");
    div("sec_msft", daysAgo(q), 67.5, "MSFT Dividend");
  }
  db.insert(investmentTransactions).values(inv).run();

  // ── Manual holding (fixed-value crypto, no network dependency) ──────────────
  db.insert(manualHoldings)
    .values([
      { id: "man_btc", symbol: null, name: "Bitcoin (cold wallet)", type: "crypto", quantity: null, costBasis: 21500, manualValue: 30800, isoCurrencyCode: "USD", createdAt: NOW, updatedAt: NOW },
    ])
    .run();

  // ── Daily balance snapshots (180d, trending up) ─────────────────────────────
  const snaps: (typeof balanceSnapshots.$inferInsert)[] = [];
  const N = 180;
  for (let i = N; i >= 0; i--) {
    const t = (N - i) / N;
    const date = daysAgo(i);
    const checking = 6800 + Math.sin(i / 9) * 1400 + between(-300, 300);
    const savings = 39000 + t * 7200 + between(-120, 120);
    const brokerage = 178000 + t * 36000 + Math.sin(i / 14) * 5200 + between(-800, 800);
    const credit = -(1200 + t * 950 + Math.abs(Math.sin(i / 11)) * 500);
    snaps.push(
      { accountId: CHECKING, date, balance: Math.round(checking), type: "depository", isoCurrencyCode: "USD" },
      { accountId: SAVINGS, date, balance: Math.round(savings), type: "depository", isoCurrencyCode: "USD" },
      { accountId: BROKERAGE, date, balance: Math.round(brokerage), type: "investment", isoCurrencyCode: "USD" },
      { accountId: CREDIT, date, balance: Math.round(credit), type: "credit", isoCurrencyCode: "USD" },
    );
  }
  db.insert(balanceSnapshots).values(snaps).run();

  // ── Transactions (90d) ──────────────────────────────────────────────────────
  type M = { name: string; merchant: string; cat: string; lo: number; hi: number; acct: string };
  const MERCHANTS: M[] = [
    { name: "WHOLEFDS", merchant: "Whole Foods Market", cat: "FOOD_AND_DRINK", lo: 40, hi: 130, acct: CREDIT },
    { name: "TRADER JOE'S", merchant: "Trader Joe's", cat: "FOOD_AND_DRINK", lo: 22, hi: 85, acct: CREDIT },
    { name: "CHIPOTLE", merchant: "Chipotle", cat: "FOOD_AND_DRINK", lo: 11, hi: 28, acct: CREDIT },
    { name: "SWEETGREEN", merchant: "Sweetgreen", cat: "FOOD_AND_DRINK", lo: 13, hi: 22, acct: CREDIT },
    { name: "BLUE BOTTLE", merchant: "Blue Bottle Coffee", cat: "FOOD_AND_DRINK", lo: 5, hi: 12, acct: CREDIT },
    { name: "UBER TRIP", merchant: "Uber", cat: "TRANSPORTATION", lo: 8, hi: 42, acct: CREDIT },
    { name: "SHELL OIL", merchant: "Shell", cat: "TRANSPORTATION", lo: 34, hi: 72, acct: CREDIT },
    { name: "AMAZON.COM", merchant: "Amazon", cat: "GENERAL_MERCHANDISE", lo: 14, hi: 165, acct: CREDIT },
    { name: "TARGET", merchant: "Target", cat: "GENERAL_MERCHANDISE", lo: 25, hi: 120, acct: CREDIT },
    { name: "STEAM GAMES", merchant: "Steam", cat: "ENTERTAINMENT", lo: 10, hi: 60, acct: CREDIT },
    { name: "CVS PHARMACY", merchant: "CVS Pharmacy", cat: "MEDICAL", lo: 8, hi: 46, acct: CREDIT },
  ];
  const RECURRING: (M & { day: number })[] = [
    { name: "NETFLIX", merchant: "Netflix", cat: "ENTERTAINMENT", lo: 15.99, hi: 15.99, acct: CREDIT, day: 4 },
    { name: "SPOTIFY", merchant: "Spotify", cat: "ENTERTAINMENT", lo: 11.99, hi: 11.99, acct: CREDIT, day: 9 },
    { name: "EQUINOX", merchant: "Equinox", cat: "PERSONAL_CARE", lo: 185, hi: 185, acct: CREDIT, day: 1 },
    { name: "PG&E", merchant: "PG&E", cat: "RENT_AND_UTILITIES", lo: 92, hi: 180, acct: CHECKING, day: 12 },
    { name: "COMCAST", merchant: "Comcast", cat: "RENT_AND_UTILITIES", lo: 79.99, hi: 79.99, acct: CHECKING, day: 15 },
    { name: "SUNSET APTS RENT", merchant: "Sunset Apartments", cat: "RENT_AND_UTILITIES", lo: 2400, hi: 2400, acct: CHECKING, day: 1 },
  ];

  const txRows: (typeof transactions.$inferInsert)[] = [];
  let txId = 0;
  const add = (date: string, amount: number, m: { name: string; merchant: string; cat: string; acct: string }) =>
    txRows.push({ id: `tx_${txId++}`, accountId: m.acct, amount, isoCurrencyCode: "USD", date, name: m.name, merchantName: m.merchant, category: m.cat, categoryDetailed: null, pending: false, paymentChannel: "in store", reviewed: true });

  for (let d = 90; d >= 0; d--) {
    const n = Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const m = pick(MERCHANTS);
      add(daysAgo(d), money(m.lo, m.hi), m);
    }
  }
  for (let mo = 0; mo < 3; mo++) {
    for (const r of RECURRING) {
      const d = new Date(NOW);
      d.setMonth(d.getMonth() - mo, r.day);
      if (d <= NOW) add(iso(d), r.lo === r.hi ? r.lo : money(r.lo, r.hi), r);
    }
  }
  for (let d = 90; d >= 0; d -= 14) {
    add(daysAgo(d), -3200, { name: "ACME CORP PAYROLL", merchant: "Acme Corp", cat: "INCOME", acct: CHECKING });
  }
  add(daysAgo(38), 612.4, { name: "DELTA AIR LINES", merchant: "Delta Air Lines", cat: "TRAVEL", acct: CREDIT });
  add(daysAgo(35), 388.0, { name: "MARRIOTT", merchant: "Marriott", cat: "TRAVEL", acct: CREDIT });
  db.insert(transactions).values(txRows).run();

  // ── Budgets (need category ids) ─────────────────────────────────────────────
  const cats = db.select().from(categories).all();
  const byPlaid = new Map(cats.map((c) => [c.plaidPrimary, c.id] as const));
  const wants: [string, number][] = [
    ["FOOD_AND_DRINK", 850],
    ["TRANSPORTATION", 320],
    ["ENTERTAINMENT", 160],
    ["GENERAL_MERCHANDISE", 500],
    ["TRAVEL", 700],
    ["RENT_AND_UTILITIES", 2800],
  ];
  const budRows = wants
    .map(([plaid, amount], i) => {
      const categoryId = byPlaid.get(plaid);
      return categoryId ? { id: `bud_${i}`, categoryId, amount, rollover: false } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r != null);
  if (budRows.length) db.insert(budgets).values(budRows).run();

  // ── FIRE + goals + milestones ──────────────────────────────────────────────
  db.insert(fireSettings)
    .values({ id: "default", annualExpenses: 72000, safeWithdrawalRate: 4, expectedReturn: 7, monthlyContribution: 3500, targetRetirementAge: 50, updatedAt: NOW })
    .run();

  db.insert(savingsGoals)
    .values([
      { id: "goal_ef", name: "Emergency Fund", icon: "ShieldCheck", color: null, targetAmount: 30000, targetDate: null, sortOrder: 0, archived: false, createdAt: NOW },
      { id: "goal_japan", name: "Japan Trip", icon: "Plane", color: null, targetAmount: 8000, targetDate: daysAgo(-200), sortOrder: 1, archived: false, createdAt: NOW },
    ])
    .run();
  db.insert(savingsContributions)
    .values([
      { id: "sc_1", goalId: "goal_ef", amount: 22000, date: daysAgo(120), note: "Initial", createdAt: NOW },
      { id: "sc_2", goalId: "goal_ef", amount: 3000, date: daysAgo(30), note: null, createdAt: NOW },
      { id: "sc_3", goalId: "goal_japan", amount: 4600, date: daysAgo(60), note: null, createdAt: NOW },
    ])
    .run();

  db.insert(netWorthMilestones)
    .values([
      { id: "nm_1", label: "First $100k", amount: 100000, achievedDate: daysAgo(700), sortOrder: 0 },
      { id: "nm_2", label: "Quarter million", amount: 250000, achievedDate: daysAgo(120), sortOrder: 1 },
      { id: "nm_3", label: "Half a million", amount: 500000, achievedDate: null, sortOrder: 2 },
    ])
    .run();

  // ── Extra fixed-id transactions for the feature overlays below ──────────────
  // These need stable ids so splits / shares / settlements / matches can point at
  // them, so they're built here rather than through the random generator above.
  const REIMB = REIMBURSABLE_CATEGORY_ID;
  const X = (o: Partial<typeof transactions.$inferInsert> & {
    id: string; accountId: string; amount: number; date: string; name: string;
  }): typeof transactions.$inferInsert => ({
    isoCurrencyCode: "USD", merchantName: null, category: null, categoryDetailed: null,
    pending: false, paymentChannel: "online", reviewed: true, ...o,
  });
  const extraTx: (typeof transactions.$inferInsert)[] = [
    // Group expenses Jordan fronted (each split below).
    X({ id: "txg_dinner", accountId: CREDIT, amount: 184.5, date: daysAgo(12), name: "OTTOS TAVERN", merchantName: "Otto's Tavern", category: "FOOD_AND_DRINK" }),
    X({ id: "txg_airbnb", accountId: CREDIT, amount: 912.0, date: daysAgo(40), name: "AIRBNB * HMK2Q", merchantName: "Airbnb", category: "TRAVEL" }),
    X({ id: "txg_concert", accountId: CREDIT, amount: 260.0, date: daysAgo(25), name: "AXS.COM TICKETS", merchantName: "AXS", category: "ENTERTAINMENT" }),
    X({ id: "txg_grocery", accountId: CREDIT, amount: 128.4, date: daysAgo(6), name: "WHOLEFDS", merchantName: "Whole Foods Market", category: "FOOD_AND_DRINK" }),
    // Repayments already recorded → filed under the Reimbursable transfer category.
    X({ id: "txg_venmo_alex", accountId: CHECKING, amount: -289.5, date: daysAgo(8), name: "VENMO PAYMENT FROM ALEX RIVERA", merchantName: "Venmo", category: "TRANSFER_IN", userCategoryId: REIMB }),
    X({ id: "txg_venmo_sam", accountId: CHECKING, amount: -61.5, date: daysAgo(9), name: "VENMO CASHOUT SAM CHEN", merchantName: "Venmo", category: "TRANSFER_IN", userCategoryId: REIMB }),
    // Repayments NOT yet filed → these drive the "repayments to confirm" inbox on
    // /shared. TRANSFER_IN keeps them out of income while they await confirmation.
    X({ id: "txg_zelle_priya", accountId: CHECKING, amount: -130.0, date: daysAgo(3), name: "ZELLE PAYMENT FROM PRIYA PATEL", merchantName: "Zelle", category: "TRANSFER_IN", reviewed: false }),
    X({ id: "txg_venmo_sam2", accountId: CHECKING, amount: -228.0, date: daysAgo(2), name: "VENMO PAYMENT FROM SAM CHEN", merchantName: "Venmo", category: "TRANSFER_IN", reviewed: false }),
    // A refund pair (same account, offsetting, <5d) → refund suggestion inbox.
    X({ id: "txg_amzn_buy", accountId: CREDIT, amount: 76.4, date: daysAgo(18), name: "AMAZON.COM*RT4D9", merchantName: "Amazon", category: "GENERAL_MERCHANDISE" }),
    X({ id: "txg_amzn_refund", accountId: CREDIT, amount: -76.4, date: daysAgo(15), name: "AMAZON.COM REFUND", merchantName: "Amazon", category: "GENERAL_MERCHANDISE" }),
    // A self-transfer pair (different accounts) → confirmed match below.
    X({ id: "txg_xfer_out", accountId: CHECKING, amount: 1500.0, date: daysAgo(10), name: "TRANSFER TO SAVINGS", category: "TRANSFER_OUT" }),
    X({ id: "txg_xfer_in", accountId: SAVINGS, amount: -1500.0, date: daysAgo(10), name: "TRANSFER FROM CHECKING", category: "TRANSFER_IN" }),
    // A plain category split (not a bill split) — demonstrates the split badge.
    X({ id: "txg_target", accountId: CREDIT, amount: 142.0, date: daysAgo(20), name: "TARGET", merchantName: "Target", category: "GENERAL_MERCHANDISE" }),
  ];
  db.insert(transactions).values(extraTx).run();

  // ── Bill splitting: people, shared expenses, shares, settlements ────────────
  db.insert(people)
    .values([
      { id: "p_alex", name: "Alex Rivera", handle: "@alex-rivera", color: null, archived: false, createdAt: NOW },
      { id: "p_sam", name: "Sam Chen", handle: "@sam-chen", color: null, archived: false, createdAt: NOW },
      { id: "p_priya", name: "Priya Patel", handle: "@priya", color: null, archived: false, createdAt: NOW },
      { id: "p_marcus", name: "Marcus Bell", handle: null, color: null, archived: false, createdAt: NOW },
    ])
    .run();

  db.insert(sharedExpenses)
    .values([
      { id: "se_dinner", transactionId: "txg_dinner", myShare: 61.5, note: "Dinner with Alex & Sam", itemsJson: null, createdAt: NOW },
      { id: "se_airbnb", transactionId: "txg_airbnb", myShare: 228.0, note: "Tahoe weekend", itemsJson: null, createdAt: NOW },
      { id: "se_concert", transactionId: "txg_concert", myShare: 130.0, note: "Concert — Priya's ticket", itemsJson: null, createdAt: NOW },
      { id: "se_grocery", transactionId: "txg_grocery", myShare: 64.2, note: "Split with roommate", itemsJson: null, createdAt: NOW },
    ])
    .run();

  db.insert(expenseShares)
    .values([
      { id: "es_dinner_alex", sharedExpenseId: "se_dinner", personId: "p_alex", amount: 61.5 },
      { id: "es_dinner_sam", sharedExpenseId: "se_dinner", personId: "p_sam", amount: 61.5 },
      { id: "es_airbnb_alex", sharedExpenseId: "se_airbnb", personId: "p_alex", amount: 228.0 },
      { id: "es_airbnb_sam", sharedExpenseId: "se_airbnb", personId: "p_sam", amount: 228.0 },
      { id: "es_airbnb_priya", sharedExpenseId: "se_airbnb", personId: "p_priya", amount: 228.0 },
      { id: "es_concert_priya", sharedExpenseId: "se_concert", personId: "p_priya", amount: 130.0 },
      { id: "es_grocery_marcus", sharedExpenseId: "se_grocery", personId: "p_marcus", amount: 64.2 },
    ])
    .run();

  // Settlements already recorded (Alex square, Sam paid the dinner only).
  db.insert(settlements)
    .values([
      { id: "st_alex", personId: "p_alex", transactionId: "txg_venmo_alex", amount: 289.5, date: daysAgo(8), note: null, createdAt: NOW },
      { id: "st_sam", personId: "p_sam", transactionId: "txg_venmo_sam", amount: 61.5, date: daysAgo(9), note: "Dinner", createdAt: NOW },
    ])
    .run();

  // ── transaction_splits: bill-split overlays + one plain category split ──────
  // Each bill split = your share at its real category + the remainder parked in
  // the Reimbursable transfer category (which reporting already nets out).
  db.insert(transactionSplits)
    .values([
      { id: "sp_dinner_mine", transactionId: "txg_dinner", categoryId: "cat_food_and_drink", amount: 61.5, note: "Your share" },
      { id: "sp_dinner_owed", transactionId: "txg_dinner", categoryId: REIMB, amount: 123.0, note: "Owed by 2 people" },
      { id: "sp_airbnb_mine", transactionId: "txg_airbnb", categoryId: "cat_travel", amount: 228.0, note: "Your share" },
      { id: "sp_airbnb_owed", transactionId: "txg_airbnb", categoryId: REIMB, amount: 684.0, note: "Owed by 3 people" },
      { id: "sp_concert_mine", transactionId: "txg_concert", categoryId: "cat_entertainment", amount: 130.0, note: "Your share" },
      { id: "sp_concert_owed", transactionId: "txg_concert", categoryId: REIMB, amount: 130.0, note: "Owed by 1 person" },
      { id: "sp_grocery_mine", transactionId: "txg_grocery", categoryId: "cat_food_and_drink", amount: 64.2, note: "Your share" },
      { id: "sp_grocery_owed", transactionId: "txg_grocery", categoryId: REIMB, amount: 64.2, note: "Owed by 1 person" },
      // Plain category split — a Target run that was part household, part pharmacy.
      { id: "sp_target_gm", transactionId: "txg_target", categoryId: "cat_general_merchandise", amount: 98.0, note: "Household" },
      { id: "sp_target_med", transactionId: "txg_target", categoryId: "cat_medical", amount: 44.0, note: "Pharmacy" },
    ])
    .run();

  // Confirm the self-transfer as a matched pair (both legs drop out of reporting).
  db.insert(transactionMatches)
    .values({ id: "tm_xfer", txnAId: "txg_xfer_out", txnBId: "txg_xfer_in", kind: "transfer", status: "confirmed", createdAt: NOW })
    .run();

  // ── Tags + auto-tag rules ───────────────────────────────────────────────────
  db.insert(tags)
    .values([
      { id: "tag_vacation", name: "Vacation", color: "#6ea8fe" },
      { id: "tag_subs", name: "Subscriptions", color: "#c07bd8" },
      { id: "tag_work", name: "Work", color: "#e0b64a" },
    ])
    .run();
  // Attach tags by merchant name so this survives the randomized ids above.
  db.run(sql`INSERT INTO transaction_tags (transaction_id, tag_id)
             SELECT id, 'tag_subs' FROM transactions
             WHERE name IN ('NETFLIX','SPOTIFY','EQUINOX','COMCAST')`);
  db.run(sql`INSERT INTO transaction_tags (transaction_id, tag_id)
             SELECT id, 'tag_vacation' FROM transactions
             WHERE name IN ('DELTA AIR LINES','MARRIOTT','AXS.COM TICKETS','AIRBNB * HMK2Q')`);
  db.run(sql`INSERT INTO transaction_tags (transaction_id, tag_id)
             SELECT id, 'tag_work' FROM transactions WHERE name = 'UBER TRIP'`);
  db.insert(tagRules)
    .values([
      { id: "tr_air", pattern: "AIRBNB", label: "Travel", tagId: "tag_vacation", matchType: "contains", minAmount: null, maxAmount: null, accountId: null, categoryId: null, createdAt: NOW },
      { id: "tr_netflix", pattern: "NETFLIX", label: "Streaming", tagId: "tag_subs", matchType: "contains", minAmount: null, maxAmount: null, accountId: null, categoryId: null, createdAt: NOW },
      { id: "tr_uber", pattern: "UBER", label: "Rides", tagId: "tag_work", matchType: "contains", minAmount: null, maxAmount: null, accountId: null, categoryId: null, createdAt: NOW },
    ])
    .run();

  // ── Recurring streams (subscriptions + payroll) ─────────────────────────────
  const recurRows: (typeof recurringStreams.$inferInsert)[] = RECURRING.map((r, i) => {
    const last = new Date(NOW);
    last.setDate(r.day);
    if (last > NOW) last.setMonth(last.getMonth() - 1);
    const next = new Date(last);
    next.setMonth(next.getMonth() + 1);
    const amt = r.lo === r.hi ? r.lo : Math.round(((r.lo + r.hi) / 2) * 100) / 100;
    return {
      id: `rs_${i}`, accountId: r.acct, direction: "outflow",
      description: r.merchant, merchantName: r.merchant, category: r.cat,
      frequency: "MONTHLY", averageAmount: amt, lastAmount: amt,
      lastDate: iso(last), predictedNextDate: iso(next), isoCurrencyCode: "USD",
      isActive: true, status: "MATURE", updatedAt: NOW,
    };
  });
  recurRows.push({
    id: "rs_payroll", accountId: CHECKING, direction: "inflow",
    description: "Acme Corp", merchantName: "Acme Corp", category: "INCOME",
    frequency: "BIWEEKLY", averageAmount: 3200, lastAmount: 3200,
    lastDate: daysAgo(4), predictedNextDate: daysAgo(-10), isoCurrencyCode: "USD",
    isActive: true, status: "MATURE", updatedAt: NOW,
  });
  db.insert(recurringStreams).values(recurRows).run();

  // ── Vendor group (merge the two grocery stores into one canonical vendor) ───
  db.insert(vendorGroups).values({ id: "vg_grocery", name: "Groceries", createdAt: NOW }).run();
  db.insert(vendorGroupMembers)
    .values([
      { vendorKey: "Whole Foods Market", groupId: "vg_grocery" },
      { vendorKey: "Trader Joe's", groupId: "vg_grocery" },
    ])
    .run();

  // ── A saved custom dashboard ────────────────────────────────────────────────
  db.insert(dashboards).values({ id: "dash_review", name: "Monthly Review", sortOrder: 0, createdAt: NOW }).run();
  db.insert(dashboardWidgets)
    .values([
      { id: "dw_1", dashboardId: "dash_review", type: "net-worth", config: null, sortOrder: 0 },
      { id: "dw_2", dashboardId: "dash_review", type: "spend-by-category", config: JSON.stringify({ days: 30 }), sortOrder: 1 },
      { id: "dw_3", dashboardId: "dash_review", type: "cashflow", config: JSON.stringify({ months: 6 }), sortOrder: 2 },
      { id: "dw_4", dashboardId: "dash_review", type: "top-vendors", config: JSON.stringify({ days: 90, limit: 8 }), sortOrder: 3 },
      { id: "dw_5", dashboardId: "dash_review", type: "budget-summary", config: null, sortOrder: 4 },
    ])
    .run();

  // ── Allocation targets + geography overrides (rebalance drift + region chart) ─
  db.insert(allocationTargets)
    .values([
      { targetKey: "class:stocks", target: 70 },
      { targetKey: "class:crypto", target: 5 },
      { targetKey: "class:options", target: 5 },
      { targetKey: "class:cash", target: 15 },
      { targetKey: "class:bonds", target: 5 },
    ])
    .run();
  db.insert(investmentGeographies)
    .values([
      { sectorKey: "sym:AAPL", region: "United States" },
      { sectorKey: "sym:MSFT", region: "United States" },
      { sectorKey: "sym:NVDA", region: "United States" },
      { sectorKey: "sym:AMZN", region: "United States" },
      { sectorKey: "sym:VOO", region: "United States" },
      { sectorKey: "sym:VTI", region: "United States" },
      { sectorKey: "sym:VXUS", region: "International" },
      { sectorKey: "man:man_btc", region: "Global" },
    ])
    .run();

  return { transactions: txRows.length + extraTx.length, budgets: budRows.length };
}

/**
 * First-run bootstrap: exactly once per install, on a truly fresh DB — no Plaid
 * keys entered and no accounts linked — seed the demo dataset and flip the demo
 * flag so the user lands on a populated dashboard instead of an empty shell or a
 * keys form.
 *
 * Gated on a persistent one-way marker (isFirstRunDone), so it never re-seeds:
 * once the user exits demo mode, the app stays a clean slate even if they abandon
 * setup before linking a bank. Cheap to call on every request — the guard
 * short-circuits with a single indexed read.
 *
 * Returns true if it seeded this call (the caller should re-read data).
 */
export function ensureFirstRunDemo(): boolean {
  // Fast path: already handled (the common case on every request after the first).
  if (isFirstRunDone()) return false;

  // Serialize the whole check-and-seed in one IMMEDIATE transaction. Next renders
  // the layout and page for a request in parallel — in production each in its own
  // worker with its own SQLite connection — and both call this. Without an
  // exclusive lock their seed passes interleave and corrupt the data (duplicate
  // rows) or lose the demo flag. BEGIN IMMEDIATE grabs the write lock up front, so
  // the second caller blocks, then re-checks and finds the work already done.
  // The read-only web demo (in-memory DB) must ALWAYS show the demo dataset, even
  // if stray Plaid env vars are present on the host — so it skips the "already
  // configured" bail below.
  const webDemo = Boolean(process.env.DEMO_DB);

  return db.transaction(
    () => {
      if (isFirstRunDone()) return false;

      // Already have data (real accounts, or demo already seeded this instance).
      const hasItems = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM items`)?.n ?? 0;
      if (hasItems > 0) {
        markFirstRunDone();
        return false;
      }

      // Real install with keys entered but nothing linked yet → let the user
      // onboard for real; don't inject demo data. (The web demo always seeds.)
      if (!webDemo && hasPlaidCredentials()) {
        markFirstRunDone();
        return false;
      }

      seedDemoData();
      setDemoMode(true);
      markFirstRunDone();
      return true;
    },
    { behavior: "immediate" },
  );
}

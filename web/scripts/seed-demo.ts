/**
 * Seeds a throwaway demo database with realistic FAKE data for marketing
 * screenshots — never the user's real accounts. Point DATABASE_PATH at a scratch
 * file (e.g. data/demo.db), run the category seed, then this:
 *
 *   DATABASE_PATH=data/demo.db npm run db:migrate
 *   DATABASE_PATH=data/demo.db npm run db:seed        # categories
 *   DATABASE_PATH=data/demo.db npx tsx scripts/seed-demo.ts
 *
 * Idempotent: wipes the tables it owns, then reinserts. Persona: "Jordan Lee",
 * net worth ~$300k — checking, high-yield savings, a credit card, a brokerage
 * with a diversified portfolio + an AAPL call spread, and a fixed-value BTC
 * holding. 180 days of daily net-worth snapshots trending up, ~130 categorized
 * transactions over 90 days, an investment ledger with a realized sale, budgets,
 * FIRE settings, goals and milestones.
 */

import { db } from "@/db";
import {
  accounts,
  balanceSnapshots,
  budgets,
  categories,
  fireSettings,
  holdings,
  investmentTransactions,
  items,
  manualHoldings,
  netWorthMilestones,
  savingsContributions,
  savingsGoals,
  securities,
  transactions,
} from "@/db/schema";

// ── Deterministic PRNG so re-runs produce identical data ────────────────────
let _seed = 1337;
function rand(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
}
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const money = (lo: number, hi: number) => Math.round(between(lo, hi) * 100) / 100;

const NOW = new Date();
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return iso(d);
}

// ── Wipe (children → parents) ───────────────────────────────────────────────
function wipe() {
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

// ── Accounts ────────────────────────────────────────────────────────────────
const CHECKING = "acc_checking";
const SAVINGS = "acc_savings";
const CREDIT = "acc_credit";
const BROKERAGE = "acc_brokerage";

function seedAccountsAndItems() {
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
}

// ── Securities + holdings ───────────────────────────────────────────────────
type Eq = { id: string; ticker: string; name: string; qty: number; close: number; basis: number };
const EQUITIES: Eq[] = [
  { id: "sec_aapl", ticker: "AAPL", name: "Apple Inc.", qty: 320, close: 235.0, basis: 48000 },
  { id: "sec_msft", ticker: "MSFT", name: "Microsoft Corp.", qty: 90, close: 430.0, basis: 26000 },
  { id: "sec_nvda", ticker: "NVDA", name: "NVIDIA Corp.", qty: 260, close: 128.0, basis: 12000 },
  { id: "sec_voo", ticker: "VOO", name: "Vanguard S&P 500 ETF", qty: 60, close: 540.0, basis: 24000 },
  { id: "sec_vti", ticker: "VTI", name: "Vanguard Total Stock Market ETF", qty: 90, close: 285.0, basis: 20000 },
  { id: "sec_amzn", ticker: "AMZN", name: "Amazon.com Inc.", qty: 40, close: 205.0, basis: 6000 },
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

function seedInvestments() {
  // Equity securities + option-leg securities.
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
      // Bull call spread: long 1x $250 call (+100 sh), short 1x $270 call (−100 sh).
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

  // AAPL: bought 400 @ 150, sold 80 @ 220 (realized long-term gain), 320 held.
  buy("sec_aapl", daysAgo(680), 400, 150, "Buy AAPL");
  sell("sec_aapl", daysAgo(210), 80, 220, "Sell AAPL");
  buy("sec_msft", daysAgo(600), 90, 289, "Buy MSFT");
  buy("sec_nvda", daysAgo(520), 160, 46, "Buy NVDA");
  buy("sec_nvda", daysAgo(300), 100, 62, "Buy NVDA");
  buy("sec_voo", daysAgo(560), 60, 400, "Buy VOO");
  buy("sec_vti", daysAgo(480), 90, 222, "Buy VTI");
  buy("sec_amzn", daysAgo(410), 40, 150, "Buy AMZN");
  // Dividends across a couple quarters.
  for (const q of [270, 180, 90]) {
    div("sec_aapl", daysAgo(q), 76.8, "AAPL Dividend");
    div("sec_voo", daysAgo(q), 84.0, "VOO Dividend");
    div("sec_msft", daysAgo(q), 67.5, "MSFT Dividend");
  }
  db.insert(investmentTransactions).values(inv).run();
}

// ── Manual holding (fixed-value crypto, no network dependency) ───────────────
function seedManual() {
  db.insert(manualHoldings)
    .values([
      { id: "man_btc", symbol: null, name: "Bitcoin (cold wallet)", type: "crypto", quantity: null, costBasis: 21500, manualValue: 30800, isoCurrencyCode: "USD", createdAt: NOW, updatedAt: NOW },
    ])
    .run();
}

// ── Daily balance snapshots (180d, trending up) ─────────────────────────────
function seedSnapshots() {
  const rows: (typeof balanceSnapshots.$inferInsert)[] = [];
  const N = 180;
  for (let i = N; i >= 0; i--) {
    const t = (N - i) / N; // 0 → 1 over the window
    const date = daysAgo(i);
    // Assets grow; the credit card is a small negative that drifts.
    const checking = 6800 + Math.sin(i / 9) * 1400 + between(-300, 300);
    const savings = 39000 + t * 7200 + between(-120, 120);
    const brokerage = 178000 + t * 36000 + Math.sin(i / 14) * 5200 + between(-800, 800);
    const credit = -(1200 + t * 950 + Math.abs(Math.sin(i / 11)) * 500);
    rows.push(
      { accountId: CHECKING, date, balance: Math.round(checking), type: "depository", isoCurrencyCode: "USD" },
      { accountId: SAVINGS, date, balance: Math.round(savings), type: "depository", isoCurrencyCode: "USD" },
      { accountId: BROKERAGE, date, balance: Math.round(brokerage), type: "investment", isoCurrencyCode: "USD" },
      { accountId: CREDIT, date, balance: Math.round(credit), type: "credit", isoCurrencyCode: "USD" },
    );
  }
  db.insert(balanceSnapshots).values(rows).run();
}

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
// Roughly-monthly recurring bills.
const RECURRING: (M & { day: number })[] = [
  { name: "NETFLIX", merchant: "Netflix", cat: "ENTERTAINMENT", lo: 15.99, hi: 15.99, acct: CREDIT, day: 4 },
  { name: "SPOTIFY", merchant: "Spotify", cat: "ENTERTAINMENT", lo: 11.99, hi: 11.99, acct: CREDIT, day: 9 },
  { name: "EQUINOX", merchant: "Equinox", cat: "PERSONAL_CARE", lo: 185, hi: 185, acct: CREDIT, day: 1 },
  { name: "PG&E", merchant: "PG&E", cat: "RENT_AND_UTILITIES", lo: 92, hi: 180, acct: CHECKING, day: 12 },
  { name: "COMCAST", merchant: "Comcast", cat: "RENT_AND_UTILITIES", lo: 79.99, hi: 79.99, acct: CHECKING, day: 15 },
  { name: "SUNSET APTS RENT", merchant: "Sunset Apartments", cat: "RENT_AND_UTILITIES", lo: 2400, hi: 2400, acct: CHECKING, day: 1 },
];

function seedTransactions() {
  const rows: (typeof transactions.$inferInsert)[] = [];
  let id = 0;
  const add = (date: string, amount: number, m: { name: string; merchant: string; cat: string; acct: string }) =>
    rows.push({ id: `tx_${id++}`, accountId: m.acct, amount, isoCurrencyCode: "USD", date, name: m.name, merchantName: m.merchant, category: m.cat, categoryDetailed: null, pending: false, paymentChannel: "in store", reviewed: true });

  // Everyday spend: 0–3 discretionary transactions per day for 90 days.
  for (let d = 90; d >= 0; d--) {
    const n = Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const m = pick(MERCHANTS);
      add(daysAgo(d), money(m.lo, m.hi), m);
    }
  }
  // Recurring monthly bills for the last 3 months.
  for (let mo = 0; mo < 3; mo++) {
    for (const r of RECURRING) {
      const d = new Date(NOW);
      d.setMonth(d.getMonth() - mo, r.day);
      if (d <= NOW) add(iso(d), r.lo === r.hi ? r.lo : money(r.lo, r.hi), r);
    }
  }
  // Biweekly payroll (income = negative amount).
  for (let d = 90; d >= 0; d -= 14) {
    add(daysAgo(d), -3200, { name: "ACME CORP PAYROLL", merchant: "Acme Corp", cat: "INCOME", acct: CHECKING });
  }
  // A couple of travel splurges.
  add(daysAgo(38), 612.4, { name: "DELTA AIR LINES", merchant: "Delta Air Lines", cat: "TRAVEL", acct: CREDIT });
  add(daysAgo(35), 388.0, { name: "MARRIOTT", merchant: "Marriott", cat: "TRAVEL", acct: CREDIT });

  db.insert(transactions).values(rows).run();
  return rows.length;
}

// ── Budgets (need category ids) ─────────────────────────────────────────────
function seedBudgets() {
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
  const rows = wants
    .map(([plaid, amount], i) => {
      const categoryId = byPlaid.get(plaid);
      return categoryId ? { id: `bud_${i}`, categoryId, amount, rollover: false } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r != null);
  if (rows.length) db.insert(budgets).values(rows).run();
  return rows.length;
}

// ── FIRE + goals + milestones ───────────────────────────────────────────────
function seedFireAndGoals() {
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
}

// ── Run ─────────────────────────────────────────────────────────────────────
wipe();
seedAccountsAndItems();
seedInvestments();
seedManual();
seedSnapshots();
const txCount = seedTransactions();
const budCount = seedBudgets();
seedFireAndGoals();

console.log("✓ Demo data seeded");
console.log(`  accounts: 4 · transactions: ${txCount} · budgets: ${budCount}`);
console.log(`  equities: ${EQUITIES.length} + AAPL spread (${LONG_CALL} / ${SHORT_CALL})`);
console.log(`  option expiry: ${iso(OPT_EXP)}`);

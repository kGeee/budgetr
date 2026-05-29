import { db } from "@/db";
import { accounts, holdings, items, securities, transactions } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

// Categories that are internal money movement, not real income/spending.
const EXCLUDED = ["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"];
const excludedList = EXCLUDED.map((c) => `'${c}'`).join(",");

export type NetWorth = { assets: number; liabilities: number; net: number };

export function getNetWorth(): NetWorth {
  const rows = db
    .select({ type: accounts.type, total: sql<number>`COALESCE(SUM(${accounts.currentBalance}), 0)` })
    .from(accounts)
    .groupBy(accounts.type)
    .all();

  let assets = 0;
  let liabilities = 0;
  for (const r of rows) {
    if (r.type === "credit" || r.type === "loan") liabilities += r.total ?? 0;
    else assets += r.total ?? 0;
  }
  return { assets, liabilities, net: assets - liabilities };
}

export function getNetWorthSeries(): { date: string; netWorth: number }[] {
  return db
    .all<{ date: string; netWorth: number }>(
      sql`SELECT date, SUM(balance) AS netWorth
          FROM balance_snapshots
          GROUP BY date
          ORDER BY date ASC`,
    )
    .map((r) => ({ date: r.date, netWorth: Number(r.netWorth) }));
}

export function getMonthlyCashflow(months = 6): {
  month: string;
  income: number;
  expenses: number;
}[] {
  const rows = db.all<{ month: string; income: number; expenses: number }>(
    sql`SELECT substr(date,1,7) AS month,
          SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS income,
          SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS expenses
        FROM transactions
        WHERE pending = 0
          AND (category IS NULL OR category NOT IN (${sql.raw(excludedList)}))
        GROUP BY month
        ORDER BY month DESC
        LIMIT ${months}`,
  );
  return rows
    .map((r) => ({ month: r.month, income: Number(r.income), expenses: Number(r.expenses) }))
    .reverse();
}

export function getSpendingByCategory(days = 30): { category: string; total: number }[] {
  return db
    .all<{ category: string; total: number }>(
      sql`SELECT COALESCE(category, 'UNCATEGORIZED') AS category, SUM(amount) AS total
          FROM transactions
          WHERE pending = 0 AND amount > 0
            AND (category IS NULL OR category NOT IN (${sql.raw(excludedList)}))
            AND date >= date('now', ${"-" + days + " days"})
          GROUP BY category
          ORDER BY total DESC`,
    )
    .map((r) => ({ category: prettyCategory(r.category), total: Number(r.total) }));
}

export function getRecentTransactions(limit = 50) {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amount: transactions.amount,
      category: transactions.category,
      pending: transactions.pending,
      accountName: accounts.name,
      currency: transactions.isoCurrencyCode,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .orderBy(desc(transactions.date))
    .limit(limit)
    .all();
}

export function getAccounts() {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      officialName: accounts.officialName,
      mask: accounts.mask,
      type: accounts.type,
      subtype: accounts.subtype,
      currentBalance: accounts.currentBalance,
      availableBalance: accounts.availableBalance,
      currency: accounts.isoCurrencyCode,
      institutionName: items.institutionName,
      itemStatus: items.status,
    })
    .from(accounts)
    .leftJoin(items, eq(accounts.itemId, items.id))
    .all();
}

export function getItems() {
  return db.select().from(items).all();
}

export function getHoldings() {
  return db
    .select({
      id: holdings.id,
      quantity: holdings.quantity,
      costBasis: holdings.costBasis,
      price: holdings.institutionPrice,
      value: holdings.institutionValue,
      currency: holdings.isoCurrencyCode,
      ticker: securities.tickerSymbol,
      securityName: securities.name,
      securityType: securities.type,
      accountName: accounts.name,
    })
    .from(holdings)
    .leftJoin(securities, eq(holdings.securityId, securities.id))
    .leftJoin(accounts, eq(holdings.accountId, accounts.id))
    .orderBy(desc(holdings.institutionValue))
    .all();
}

export function prettyCategory(c: string | null): string {
  if (!c) return "Uncategorized";
  return c
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

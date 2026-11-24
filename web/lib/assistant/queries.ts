/**
 * Read-only date-range queries the assistant's tools need that the pages don't
 * (the pages work in fixed windows: "last 30 days", "last 6 months"). Built on
 * the same spend_rows CTE and settled-only rule as every other spend figure, so
 * the assistant's numbers match the app's: user category overrides and splits
 * honoured, confirmed transfer/refund legs dropped, transfers left out.
 *
 * Server-only.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { effectiveCatId, spendRowsCte } from "@/lib/queries";
import { settledOnly } from "@/lib/pending";
import { cleanTransactionName } from "@/lib/utils";

export type Granularity = "day" | "week" | "month";

const cents = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;

/** SQL bucket key for a date column at the given granularity. Weeks start Monday. */
function bucket(col: ReturnType<typeof sql>, g: Granularity) {
  if (g === "month") return sql`substr(${col}, 1, 7)`;
  if (g === "week") return sql`date(${col}, '-6 days', 'weekday 1')`;
  return sql`${col}`;
}

export type CategoryTotal = { category: string; group: string | null; spent: number; transactions: number };

/** Spending per category between two dates (inclusive), largest first. */
export function spendingByCategory(from: string, to: string): CategoryTotal[] {
  return db
    .all<{ name: string | null; grp: string | null; spent: number; n: number }>(
      sql`WITH ${spendRowsCte}
          SELECT cat.name AS name, cat."group" AS grp, SUM(sr.amount) AS spent, COUNT(*) AS n
          FROM spend_rows sr
          LEFT JOIN categories cat ON cat.id = sr.category_id
          WHERE ${settledOnly("sr")} AND sr.amount > 0
            AND (cat."group" IS NULL OR cat."group" <> 'transfer')
            AND sr.date >= ${from} AND sr.date <= ${to}
          GROUP BY cat.id
          ORDER BY spent DESC`,
    )
    .map((r) => ({
      category: r.name ?? "Uncategorized",
      group: r.grp,
      spent: cents(r.spent),
      transactions: Number(r.n),
    }));
}

export type CashflowPoint = { period: string; spent: number; income: number };

/**
 * Spending and income per period between two dates. With a category id, only
 * that category's rows count (a split transaction counts its share).
 */
export function cashflowOverTime(
  from: string,
  to: string,
  granularity: Granularity,
  categoryId?: string,
): CashflowPoint[] {
  const key = bucket(sql`sr.date`, granularity);
  const cat = categoryId ? sql`AND sr.category_id = ${categoryId}` : sql``;
  return db
    .all<{ period: string; spent: number; income: number }>(
      sql`WITH ${spendRowsCte}
          SELECT ${key} AS period,
                 SUM(CASE WHEN sr.amount > 0 THEN sr.amount ELSE 0 END) AS spent,
                 SUM(CASE WHEN sr.amount < 0 THEN -sr.amount ELSE 0 END) AS income
          FROM spend_rows sr
          LEFT JOIN categories c ON c.id = sr.category_id
          WHERE ${settledOnly("sr")}
            AND (c."group" IS NULL OR c."group" <> 'transfer')
            AND sr.date >= ${from} AND sr.date <= ${to}
            ${cat}
          GROUP BY period
          ORDER BY period ASC`,
    )
    .map((r) => ({ period: r.period, spent: cents(r.spent), income: cents(r.income) }));
}

export type MerchantTotal = { merchant: string; spent: number; transactions: number };

/** Highest-spend merchants between two dates, transfers excluded. */
export function topMerchants(from: string, to: string, limit: number): MerchantTotal[] {
  return db
    .all<{ vendor: string | null; total: number; n: number }>(
      sql`SELECT COALESCE(t.merchant_name, t.name) AS vendor, SUM(t.amount) AS total, COUNT(*) AS n
          FROM transactions t
          LEFT JOIN categories cat ON cat.id = ${effectiveCatId("t")}
          WHERE ${settledOnly()} AND t.amount > 0
            AND (cat."group" IS NULL OR cat."group" <> 'transfer')
            AND t.date >= ${from} AND t.date <= ${to}
          GROUP BY vendor
          ORDER BY total DESC
          LIMIT ${limit}`,
    )
    .map((r) => ({
      merchant: cleanTransactionName(r.vendor ?? "Unknown", null),
      spent: cents(r.total),
      transactions: Number(r.n),
    }));
}

/** Keep the last point of each bucket from a dated series (e.g. month-end net worth). */
export function lastPerBucket<T extends { date: string }>(points: T[], g: Granularity): T[] {
  if (g === "day") return points;
  const keyOf = (d: string) => {
    if (g === "month") return d.slice(0, 7);
    // ISO-ish week key: the Monday on or before the date.
    const dt = new Date(`${d}T00:00:00Z`);
    const dow = (dt.getUTCDay() + 6) % 7; // 0 = Monday
    dt.setUTCDate(dt.getUTCDate() - dow);
    return dt.toISOString().slice(0, 10);
  };
  const out = new Map<string, T>();
  for (const p of points) out.set(keyOf(p.date), p); // later points overwrite earlier ones
  return [...out.values()];
}

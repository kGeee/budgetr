import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getBudgetMonth, type RecurringRow } from "@/lib/queries";

// Mirror of queries.ts: Plaid primaries mapped to a `transfer` category are
// internal money movement, not real income/spend, so they're excluded from all
// cashflow math. Redeclared locally to keep this module self-contained.
const transferPrimaries = sql`
  SELECT plaid_primary FROM categories
  WHERE "group" = 'transfer' AND plaid_primary IS NOT NULL`;

/** How many days a 'YYYY-MM' month has. */
function daysInMonthOf(month: string): number {
  const [yy, mm] = month.split("-").map(Number);
  return new Date(yy, mm, 0).getDate();
}

/** A 'YYYY-MM-DD' string for the given day-of-month within `month`. */
function dayStr(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

export type CashflowForecast = {
  month: string;
  /** Sum of current balances across depository (cash) accounts, right now. */
  currentCash: number;
  /** Non-transfer income booked so far this month. */
  mtdIncome: number;
  /** Non-transfer spending booked so far this month. */
  mtdSpend: number;
  /** Remaining recurring outflows (bills) predicted between today and month-end. */
  remainingBills: number;
  /** Remaining recurring inflows (income) predicted between today and month-end. */
  remainingIncome: number;
  /** Discretionary spend projected for the rest of the month from month-to-date pace. */
  paceSpend: number;
  /** currentCash − remainingBills + remainingIncome − paceSpend. */
  projectedEndBalance: number;
  daysElapsed: number;
  daysRemaining: number;
};

/**
 * Project the end-of-month cash balance by combining current liquid balances,
 * month-to-date net flow, the recurring bills/income still to land this month,
 * and a discretionary spending-pace projection. Fully derived — reads accounts,
 * transactions, and recurring_streams. Foundational read-only module reused by
 * FIRE tracking.
 */
export function getCashflowForecast(month: string = getBudgetMonth()): CashflowForecast {
  const daysInMonth = daysInMonthOf(month);
  const nowMonth = new Date().toISOString().slice(0, 7);
  // Days already elapsed within the target month: the calendar day when it's the
  // current month, the whole month when it's in the past, none when it's ahead.
  const daysElapsed =
    month === nowMonth
      ? Math.min(new Date().getDate(), daysInMonth)
      : month < nowMonth
        ? daysInMonth
        : 0;
  const daysRemaining = daysInMonth - daysElapsed;
  const monthEnd = dayStr(month, daysInMonth);

  // Liquid cash: depository balances as they stand right now.
  const currentCash = Number(
    db.get<{ v: number }>(
      sql`SELECT COALESCE(SUM(current_balance), 0) AS v
          FROM accounts WHERE type = 'depository'`,
    )?.v ?? 0,
  );

  // Month-to-date flow, transfers excluded (mirrors getMonthlyCashflow).
  const mtd = db.get<{ income: number; spend: number }>(sql`
    SELECT COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS spend
    FROM transactions
    WHERE pending = 0
      AND substr(date, 1, 7) = ${month}
      AND (category IS NULL OR category NOT IN (${transferPrimaries}))`);
  const mtdIncome = Number(mtd?.income ?? 0);
  const mtdSpend = Number(mtd?.spend ?? 0);

  // Recurring streams still predicted to land between today and month-end.
  const recurring = db.all<{ direction: string; total: number }>(sql`
    SELECT direction, COALESCE(SUM(ABS(COALESCE(average_amount, 0))), 0) AS total
    FROM recurring_streams
    WHERE is_active = 1
      AND predicted_next_date IS NOT NULL
      AND predicted_next_date >= date('now')
      AND predicted_next_date <= ${monthEnd}
    GROUP BY direction`);
  let remainingBills = 0;
  let remainingIncome = 0;
  for (const r of recurring) {
    if (r.direction === "outflow") remainingBills += Number(r.total);
    else if (r.direction === "inflow") remainingIncome += Number(r.total);
  }

  // Discretionary pace: extrapolate month-to-date spend across the days left.
  const paceSpend = daysElapsed > 0 ? (mtdSpend / daysElapsed) * daysRemaining : 0;

  const projectedEndBalance =
    currentCash - remainingBills + remainingIncome - paceSpend;

  return {
    month,
    currentCash,
    mtdIncome,
    mtdSpend,
    remainingBills,
    remainingIncome,
    paceSpend,
    projectedEndBalance,
    daysElapsed,
    daysRemaining,
  };
}

export type ForecastPoint = {
  date: string;
  /** Reconstructed end-of-day cash up to today, else null. */
  actual: number | null;
  /** Projected cash from today forward, else null. Lines share today's point. */
  projected: number | null;
};

/**
 * Day-by-day balance series for the month: the `actual` line reconstructs cash
 * up to today from month-to-date net flow (anchored so today equals currentCash),
 * the `projected` line runs from today to month-end subtracting cumulative
 * pro-rated pace spend and any bills/income dated on or before each day. Both
 * carry a value on today's date so the solid and dashed lines meet.
 */
export function getForecastSeries(month: string = getBudgetMonth()): ForecastPoint[] {
  const f = getCashflowForecast(month);
  const daysInMonth = f.daysElapsed + f.daysRemaining;
  const todayDay = f.daysElapsed; // 0 when the month is entirely in the future

  // Per-day non-transfer net flow (income − spend) for the elapsed portion.
  const flowRows = db.all<{ date: string; income: number; spend: number }>(sql`
    SELECT date,
           SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS income,
           SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS spend
    FROM transactions
    WHERE pending = 0
      AND substr(date, 1, 7) = ${month}
      AND (category IS NULL OR category NOT IN (${transferPrimaries}))
    GROUP BY date`);
  const netByDate = new Map<string, number>();
  for (const r of flowRows) netByDate.set(r.date, Number(r.income) - Number(r.spend));

  // Start-of-month cash so that walking net flow forward lands on currentCash at today.
  const startBalance = f.currentCash - (f.mtdIncome - f.mtdSpend);

  // Remaining recurring events keyed by their predicted date, split by direction.
  const eventRows = db.all<{ date: string; direction: string; amount: number }>(sql`
    SELECT predicted_next_date AS date, direction,
           COALESCE(SUM(ABS(COALESCE(average_amount, 0))), 0) AS amount
    FROM recurring_streams
    WHERE is_active = 1
      AND predicted_next_date IS NOT NULL
      AND predicted_next_date >= date('now')
      AND predicted_next_date <= ${dayStr(month, daysInMonth)}
    GROUP BY predicted_next_date, direction`);
  const eventByDate = new Map<string, { bills: number; income: number }>();
  for (const r of eventRows) {
    const e = eventByDate.get(r.date) ?? { bills: 0, income: 0 };
    if (r.direction === "outflow") e.bills += Number(r.amount);
    else if (r.direction === "inflow") e.income += Number(r.amount);
    eventByDate.set(r.date, e);
  }

  const dailyPace = f.daysRemaining > 0 ? f.paceSpend / f.daysRemaining : 0;

  const points: ForecastPoint[] = [];
  let runningActual = startBalance;
  let cumBills = 0;
  let cumIncome = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = dayStr(month, d);
    runningActual += netByDate.get(date) ?? 0;

    let actual: number | null = null;
    let projected: number | null = null;

    if (todayDay > 0 && d <= todayDay) actual = runningActual;

    if (d >= todayDay) {
      const ev = eventByDate.get(date);
      // Bills/income landing after today shift the projection from that day on.
      if (d > todayDay && ev) {
        cumBills += ev.bills;
        cumIncome += ev.income;
      }
      const stepsFromToday = Math.max(0, d - todayDay);
      projected =
        f.currentCash - dailyPace * stepsFromToday - cumBills + cumIncome;
    }

    points.push({ date, actual, projected });
  }
  return points;
}

/**
 * Remaining recurring streams predicted to land between today and month-end,
 * split into bills (outflow) and income (inflow) — the RecurringRow shape the
 * page renders. Soonest predicted date first.
 */
export function getRemainingRecurring(month: string = getBudgetMonth()): {
  bills: RecurringRow[];
  income: RecurringRow[];
} {
  const daysInMonth = daysInMonthOf(month);
  const monthEnd = dayStr(month, daysInMonth);
  const rows = db.all<RecurringRow>(sql`
    SELECT r.id AS id, r.direction AS direction, r.description AS description,
           r.merchant_name AS merchantName, r.category AS category, r.frequency AS frequency,
           r.average_amount AS averageAmount, r.last_amount AS lastAmount,
           r.last_date AS lastDate, r.predicted_next_date AS predictedNextDate,
           r.iso_currency_code AS currency, a.name AS accountName, r.status AS status
    FROM recurring_streams r
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE r.is_active = 1
      AND r.predicted_next_date IS NOT NULL
      AND r.predicted_next_date >= date('now')
      AND r.predicted_next_date <= ${monthEnd}
    ORDER BY r.predicted_next_date ASC, r.average_amount DESC`);
  return {
    bills: rows.filter((r) => r.direction === "outflow"),
    income: rows.filter((r) => r.direction === "inflow"),
  };
}

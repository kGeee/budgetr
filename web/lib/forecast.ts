import { db } from "@/db";
import { sql } from "drizzle-orm";
import { addDays, format, parseISO } from "date-fns";
import { streamOccurrences } from "@/lib/recurrence";
import type { RecurringRow } from "@/lib/queries";

/**
 * Current calendar month as 'YYYY-MM'. A cash forecast is always about the month
 * in progress, so — unlike the Budgets page's getBudgetMonth() — it must NOT fall
 * back to the latest month that happens to have (non-pending) data. Early in a
 * month, or when this month's transactions are still all pending, that fallback
 * points at a closed past month and the forecast reads "Month closed" with zeros.
 */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

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

// ── Recurring stream projection ───────────────────────────────────────────────

type StreamRow = {
  id: string;
  direction: "inflow" | "outflow";
  description: string | null;
  merchantName: string | null;
  category: string | null;
  frequency: string | null;
  averageAmount: number | null;
  lastAmount: number | null;
  lastDate: string | null;
  predictedNextDate: string | null;
  currency: string | null;
  accountName: string | null;
  status: string | null;
};

/** One projected landing of a recurring stream on a specific date. */
type Occurrence = { date: string; direction: "inflow" | "outflow"; amount: number; stream: StreamRow };

/** Active recurring streams, excluding those on hidden accounts. */
function activeStreams(): StreamRow[] {
  return db.all<StreamRow>(sql`
    SELECT r.id AS id, r.direction AS direction, r.description AS description,
           r.merchant_name AS merchantName, r.category AS category, r.frequency AS frequency,
           r.average_amount AS averageAmount, r.last_amount AS lastAmount,
           r.last_date AS lastDate, r.predicted_next_date AS predictedNextDate,
           r.iso_currency_code AS currency, a.name AS accountName, r.status AS status
    FROM recurring_streams r
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE r.is_active = 1 AND COALESCE(a.excluded, 0) = 0`);
}

/**
 * Every recurring occurrence still ahead of us this month — strictly after today
 * for the current month (today's cash already reflects anything cleared), the
 * whole month when it's a future month. Anchors on the stored prediction, falling
 * back to the last observed date so a stream with a null prediction still projects.
 */
function projectOccurrences(month: string): Occurrence[] {
  const nowISO = new Date().toISOString().slice(0, 10);
  const monthStart = `${month}-01`;
  const monthEnd = dayStr(month, daysInMonthOf(month));
  // Day after today for the current/past month; month start for a future month.
  const dayAfterToday = format(addDays(parseISO(nowISO), 1), "yyyy-MM-dd");
  const from = nowISO >= monthStart ? dayAfterToday : monthStart;

  const out: Occurrence[] = [];
  for (const s of activeStreams()) {
    const anchor = s.predictedNextDate ?? s.lastDate;
    if (!anchor) continue;
    const amount = Math.abs(s.averageAmount ?? 0);
    for (const date of streamOccurrences(anchor, s.frequency, from, monthEnd)) {
      out.push({ date, direction: s.direction, amount, stream: s });
    }
  }
  return out;
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
  /** Discretionary spend projected for the rest of the month. */
  paceSpend: number;
  /** True when paceSpend fell back to the trailing-30-day rate (no booked spend this month yet). */
  paceEstimated: boolean;
  /** currentCash − remainingBills + remainingIncome − paceSpend. */
  projectedEndBalance: number;
  daysElapsed: number;
  daysRemaining: number;
};

/**
 * Project the end-of-month cash balance by combining current liquid balances,
 * the recurring bills/income still to land this month (rolled forward by
 * frequency), and a discretionary spending-pace projection. Fully derived —
 * reads accounts, transactions, and recurring_streams.
 */
export function getCashflowForecast(month: string = currentMonth()): CashflowForecast {
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

  // Liquid cash: depository balances as they stand right now (hidden accounts out).
  const currentCash = Number(
    db.get<{ v: number }>(
      sql`SELECT COALESCE(SUM(current_balance), 0) AS v
          FROM accounts WHERE type = 'depository' AND excluded = 0`,
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

  // Recurring bills/income still to land, projected forward by frequency.
  let remainingBills = 0;
  let remainingIncome = 0;
  for (const o of projectOccurrences(month)) {
    if (o.direction === "outflow") remainingBills += o.amount;
    else if (o.direction === "inflow") remainingIncome += o.amount;
  }

  // Discretionary pace: extrapolate this month's booked daily spend across the
  // days left. When nothing has posted yet (early month, or all-pending), fall
  // back to the trailing-30-day daily rate so the projection isn't trivially flat.
  const mtdDaily = daysElapsed > 0 ? mtdSpend / daysElapsed : 0;
  let dailySpendRate = mtdDaily;
  let paceEstimated = false;
  if (mtdDaily <= 0) {
    const trailing = Number(
      db.get<{ v: number }>(sql`
        SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS v
        FROM transactions
        WHERE pending = 0
          AND date >= date('now', '-30 days') AND date < date('now')
          AND (category IS NULL OR category NOT IN (${transferPrimaries}))`)?.v ?? 0,
    );
    dailySpendRate = trailing / 30;
    paceEstimated = dailySpendRate > 0;
  }
  const paceSpend = dailySpendRate * daysRemaining;

  const projectedEndBalance = currentCash - remainingBills + remainingIncome - paceSpend;

  return {
    month,
    currentCash,
    mtdIncome,
    mtdSpend,
    remainingBills,
    remainingIncome,
    paceSpend,
    paceEstimated,
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
 * pro-rated pace spend and any bills/income landing on or before each day. Both
 * carry a value on today's date so the solid and dashed lines meet.
 */
export function getForecastSeries(month: string = currentMonth()): ForecastPoint[] {
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

  // Remaining recurring events keyed by their projected date, split by direction.
  const eventByDate = new Map<string, { bills: number; income: number }>();
  for (const o of projectOccurrences(month)) {
    const e = eventByDate.get(o.date) ?? { bills: 0, income: 0 };
    if (o.direction === "outflow") e.bills += o.amount;
    else if (o.direction === "inflow") e.income += o.amount;
    eventByDate.set(o.date, e);
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
      projected = f.currentCash - dailyPace * stepsFromToday - cumBills + cumIncome;
    }

    points.push({ date, actual, projected });
  }
  return points;
}

/**
 * Remaining recurring events between today and month-end — one row per projected
 * occurrence (a biweekly paycheck appears twice, on each date it lands), split
 * into bills (outflow) and income (inflow). Soonest first. Row ids are keyed by
 * occurrence so the same stream on two dates stays distinct.
 */
export function getRemainingRecurring(month: string = currentMonth()): {
  bills: RecurringRow[];
  income: RecurringRow[];
} {
  const rows: RecurringRow[] = projectOccurrences(month)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount))
    .map((o) => ({
      id: `${o.stream.id}:${o.date}`,
      direction: o.stream.direction,
      description: o.stream.description,
      merchantName: o.stream.merchantName,
      category: o.stream.category,
      frequency: o.stream.frequency,
      averageAmount: o.stream.averageAmount,
      lastAmount: o.stream.lastAmount,
      lastDate: o.stream.lastDate,
      predictedNextDate: o.date,
      currency: o.stream.currency,
      accountName: o.stream.accountName,
      status: o.stream.status,
    }));
  return {
    bills: rows.filter((r) => r.direction === "outflow"),
    income: rows.filter((r) => r.direction === "inflow"),
  };
}

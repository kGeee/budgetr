/**
 * The sentence under the Budgets hero. The page used to state the month's pace
 * only in a footer under the chart; this turns the same arithmetic into the
 * first thing read: are you under or ahead of an even burn, and by how much.
 *
 * Pure and date-injected so it can be tested without a clock.
 */

export type BudgetVerdict = {
  tone: "jade" | "brass" | "coral";
  /** Words before the figure. */
  lead: string;
  /** The amount the sentence turns on — format it at the call site. */
  amount: number;
  /** Words after the figure, including the full stop. */
  tail: string;
  /** Present only when the month is projected to finish over budget. */
  projectedOver?: number;
  /**
   * What the sentence judged: every budget, or — once any budget is flagged
   * fixed — only the flexible ones.
   */
  scope: "all" | "flexible";
};

function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * Fixed budgets (rent, a loan payment) land in one charge, so holding them to
 * an even daily burn makes every month look ahead of pace on the 1st. When any
 * are passed, pace is judged on what is left — the flexible budgets — and the
 * sentence says so. With none (`fixedBudget` and `fixedSpent` both 0) this is
 * exactly the whole-month verdict it has always been.
 *
 * @param month       the month on screen, `YYYY-MM`
 * @param today       today's local date, `YYYY-MM-DD`
 * @param totalBudget every budget, fixed ones included
 * @param fixedBudget the part of `totalBudget` flagged fixed
 * @param fixedSpent  the part of `totalSpent` in fixed categories
 */
export function budgetVerdict({
  month,
  today,
  totalBudget: allBudget,
  totalSpent: allSpent,
  fixedBudget = 0,
  fixedSpent = 0,
}: {
  month: string;
  today: string;
  totalBudget: number;
  totalSpent: number;
  fixedBudget?: number;
  fixedSpent?: number;
}): BudgetVerdict | null {
  if (!(allBudget > 0)) return null;

  // Only narrow to flexible when something flexible is left to judge; a month
  // of nothing but fixed budgets falls back to the plain whole-month reading.
  const flexibleBudget = allBudget - fixedBudget;
  const scope: BudgetVerdict["scope"] =
    fixedBudget > 0 && flexibleBudget > 0.005 ? "flexible" : "all";
  const totalBudget = scope === "flexible" ? flexibleBudget : allBudget;
  const totalSpent = scope === "flexible" ? allSpent - fixedSpent : allSpent;
  const subject = scope === "flexible" ? "Flexible spending" : "Spending";

  const total = daysIn(month);
  const current = today.slice(0, 7) === month;
  const day = current ? Math.min(total, Math.max(1, Number(today.slice(8, 10)))) : total;
  const left = total - day;
  const over = totalSpent - totalBudget;

  if (over > 0.005) {
    return {
      tone: "coral",
      lead: scope === "flexible" ? "Flexible spending is" : "You are",
      amount: over,
      tail: current && left > 0 ? `over budget with ${days(left)} left.` : "over budget.",
      scope,
    };
  }

  // A month that has already closed has no pace — only a result.
  if (!current || left === 0) {
    return {
      tone: "jade",
      lead: scope === "flexible" ? "Flexible spending closed" : "The month closed",
      amount: -over,
      tail: "under budget.",
      scope,
    };
  }

  const expected = (totalBudget * day) / total;
  const gap = expected - totalSpent;
  if (gap >= 0) {
    return {
      tone: "jade",
      lead: `${subject} is`,
      amount: gap,
      tail: `under an even pace, with ${days(left)} left.`,
      scope,
    };
  }

  const projected = (totalSpent / day) * total;
  return {
    tone: "brass",
    lead: `${subject} is`,
    amount: -gap,
    tail: `ahead of an even pace, with ${days(left)} left.`,
    projectedOver: Math.max(0, projected - totalBudget),
    scope,
  };
}

// ── Per-row status ───────────────────────────────────────────────────────────

export type BudgetStatus = { label: string; tone: "jade" | "brass" | "coral" | "muted" };

/**
 * The one status word at the end of a budget row.
 *
 * A fixed budget has no pace, only whether the bill has gone out: nothing yet,
 * part of it, or (from four fifths of the budget up) paid. A flexible budget is
 * held to an even burn while its month is running, and to its limit afterwards.
 *
 * @param elapsed share of the month gone, 0–1; pass 1 for a closed month
 */
export function budgetStatus({
  spent,
  budget,
  fixed,
  elapsed,
}: {
  spent: number;
  budget: number;
  fixed: boolean;
  elapsed: number;
}): BudgetStatus | null {
  if (!(budget > 0)) return null;
  if (spent - budget > 0.005) return { label: "Over", tone: "coral" };
  if (fixed) {
    if (spent <= 0.005) return { label: "Not yet paid", tone: "muted" };
    return spent >= budget * 0.8
      ? { label: "Paid", tone: "brass" }
      : { label: "Part paid", tone: "brass" };
  }
  if (spent <= 0.005) return { label: "Untouched", tone: "muted" };
  if (elapsed >= 1) return { label: "Under budget", tone: "jade" };
  return spent <= budget * elapsed + 0.005
    ? { label: "Under pace", tone: "jade" }
    : { label: "Ahead of pace", tone: "brass" };
}

// ── Pace series ──────────────────────────────────────────────────────────────

export type PacePoint = { date: string; spent: number | null; pace: number };

export type PaceSeries = {
  data: PacePoint[];
  /** Day of the month the actual line runs to (the whole month once closed). */
  lastActualDay: number;
  daysInMonth: number;
  /** True when `today` falls inside `month`. */
  current: boolean;
  spentToDate: number;
  paceToDate: number;
  /** Month-end spend if every remaining day matched the average so far. */
  projected: number;
  aheadOfPace: boolean;
};

/**
 * Cumulative spend against an even burn of `budget`, one point per day. `rows`
 * is the per-category/day spend already on the Budgets page; `include` picks
 * which categories count — everything, the flexible ones, or a single focused
 * category — so every reading comes from the same set and cannot disagree.
 */
export function paceSeries({
  month,
  today,
  budget,
  rows,
  include,
}: {
  month: string;
  today: string;
  budget: number;
  rows: { categoryId: string; date: string; spent: number }[];
  include?: (categoryId: string) => boolean;
}): PaceSeries {
  const total = daysIn(month);
  const current = today.slice(0, 7) === month;
  const lastActualDay = current ? Math.min(total, Math.max(1, Number(today.slice(8, 10)))) : total;

  const byDate = new Map<string, number>();
  for (const row of rows) {
    if (include && !include(row.categoryId)) continue;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.spent);
  }

  let cum = 0;
  const data: PacePoint[] = [];
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    cum += byDate.get(date) ?? 0;
    data.push({ date, spent: d <= lastActualDay ? cum : null, pace: (budget * d) / total });
  }

  const spentToDate = data[lastActualDay - 1]?.spent ?? 0;
  const paceToDate = (budget * lastActualDay) / total;
  return {
    data,
    lastActualDay,
    daysInMonth: total,
    current,
    spentToDate,
    paceToDate,
    projected: (spentToDate / lastActualDay) * total,
    aheadOfPace: spentToDate > paceToDate,
  };
}

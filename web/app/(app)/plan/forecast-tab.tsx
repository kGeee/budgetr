import { format, parseISO } from "date-fns";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ForecastChart } from "@/components/charts";
import { DataFreshnessBanner } from "@/components/data-freshness";
import { getDataFreshness } from "@/lib/data-freshness";
import { GoalContributeButton } from "@/components/budget/savings-goals";
import { Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import { todayIso } from "@/lib/data-freshness";
import { getFireMetrics } from "@/lib/fire";
import { loadInclusiveNetWorth } from "@/lib/net-worth";
import { getCashflowForecast, getForecastSeries, getRemainingRecurring } from "@/lib/forecast";
import { forecastVerdict } from "@/lib/forecast-verdict";
import { cadenceLabel, daysUntil, dueIn } from "@/lib/plan-verdict";
import { getRecurringStreams, getSavingsGoals } from "@/lib/queries";
import type { RecurringRow, SavingsGoalRow } from "@/lib/queries";
import { daysLate, splitByDue, streamLabel } from "@/lib/recurring";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";

/** How many streams the "Upcoming after" list shows before pointing at the tab. */
const LATER_LIMIT = 6;

/**
 * This month tab of /plan — the old /cashflow page. Laid out as a statement:
 * where cash lands and the balance line beside it, then what is still to clear
 * and land on ruled rows, with the two long-horizon summaries (goals, FIRE) in
 * the side column. The full recurring list lives one tab over.
 */
export async function ForecastTab() {
  const forecast = getCashflowForecast();
  const series = getForecastSeries(forecast.month);
  const { bills, income } = getRemainingRecurring(forecast.month);

  const {
    month,
    currentCash,
    remainingBills,
    remainingIncome,
    paceSpend,
    paceEstimated,
    projectedEndBalance,
  } = forecast;
  const negative = projectedEndBalance < 0;
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Every figure on this page is downstream of one number — the cash balance —
  // and that balance is only as current as the last successful refresh. A
  // projection to Aug 31 built on an Aug 2 balance is not wrong so much as
  // unqualified, so the page now stamps the age wherever the balance appears.
  const freshness = getDataFreshness();
  const balanceAsOf = freshness.connections.all.reduce<Date | null>(
    (latest, c) =>
      c.lastSuccessAt && (!latest || c.lastSuccessAt > latest) ? c.lastSuccessAt : latest,
    null,
  );
  const balanceStale = freshness.connections.daysSinceAnySync >= 1;
  const asOfLabel = balanceAsOf ? format(balanceAsOf, "MMM d") : null;

  const daysInMonth = forecast.daysElapsed + forecast.daysRemaining;
  const isCurrentMonth = new Date().toISOString().slice(0, 7) === month;
  const today =
    isCurrentMonth && forecast.daysElapsed > 0
      ? `${month}-${String(forecast.daysElapsed).padStart(2, "0")}`
      : null;

  // Lowest projected balance during the month — an intra-month dip can go
  // negative (overdraft) even when the month ends in the black, e.g. when big
  // bills clear before payday. Surfaced as a heads-up above the chart.
  const projectedPts = series.filter(
    (p): p is { date: string; actual: number | null; projected: number } => p.projected != null,
  );
  const lowest = projectedPts.reduce<{ date: string; amount: number } | null>(
    (m, p) => (!m || p.projected < m.amount ? { date: p.date, amount: p.projected } : m),
    null,
  );
  const willOverdraft = !!lowest && lowest.amount < 0;
  const showLowNote = !!lowest && lowest.amount < projectedEndBalance - 1;
  const todayStr = todayIso();
  const monthName = format(parseISO(`${month}-01`), "MMMM");
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  // Streams whose next date falls after this month, and bills whose date has
  // passed with no charge seen — neither is in the month's projection above.
  const streams = getRecurringStreams();
  const laterAll = streams
    .filter((r) => r.predictedNextDate != null && r.predictedNextDate > monthEnd)
    .sort((a, b) => a.predictedNextDate!.localeCompare(b.predictedNextDate!));
  const later = laterAll.slice(0, LATER_LIMIT);
  const awaiting = splitByDue(
    streams.filter((r) => r.direction === "outflow"),
    todayStr,
  ).overdue;
  const billsTotal = bills.reduce((s, b) => s + Math.abs(b.averageAmount ?? 0), 0);
  const incomeTotal = income.reduce((s, b) => s + Math.abs(b.averageAmount ?? 0), 0);

  const goals = getSavingsGoals().filter((g) => !g.archived);
  // Net worth includes manual and imported holdings (lib/net-worth).
  const fire = getFireMetrics(await loadInclusiveNetWorth().catch(() => undefined));

  const verdict = forecastVerdict({
    currentCash,
    projectedEndBalance,
    daysRemaining: forecast.daysRemaining,
  });

  return (
    <div className="space-y-9">
      <DataFreshnessBanner freshness={freshness} />

      {/* The month's one figure is where cash lands; the sentence says how far
          that is from today, the rule under it holds the four figures the
          projection is made of, and the balance line sits beside it. */}
      <section
        className="flex flex-wrap items-stretch gap-10"
        aria-label={`${monthLabel} cash forecast`}
      >
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3.5">
          <Hero
            eyebrow={`Projected end of ${monthName}`}
            figure={formatCurrency(projectedEndBalance)}
            tone={negative ? "coral" : "default"}
            verdict={
              <>
                {verdict.lead} <Mark tone={verdict.tone}>{formatCurrency(verdict.amount)}</Mark>{" "}
                {verdict.tail}
              </>
            }
          >
            {(willOverdraft || showLowNote) && lowest && (
              <p
                className={`flex items-start gap-2 text-[13px] ${
                  willOverdraft ? "text-[var(--coral)]" : "text-[var(--muted)]"
                }`}
              >
                {willOverdraft && <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />}
                <span>
                  {willOverdraft ? (
                    <>
                      Cash is projected to dip to{" "}
                      <span className="mono font-medium">{formatCurrency(lowest.amount)}</span> on{" "}
                      {format(parseISO(lowest.date), "MMM d")} before month-end — watch for an
                      overdraft around then.
                    </>
                  ) : (
                    <>
                      The low point is {format(parseISO(lowest.date), "MMMM d")}, at{" "}
                      <span className="mono text-[var(--paper)]">
                        {formatCurrency(lowest.amount)}
                      </span>
                      .
                    </>
                  )}
                </span>
              </p>
            )}
          </Hero>
          <StatStrip className="mt-auto">
            <Stat
              label={asOfLabel && balanceStale ? `Cash · as of ${asOfLabel}` : "Cash today"}
              value={formatCurrency(currentCash)}
            />
            <Stat
              label="Bills remaining"
              value={`−${formatCurrency(remainingBills)}`}
              tone="coral"
            />
            <Stat
              label="Income remaining"
              value={`+${formatCurrency(remainingIncome)}`}
              tone="jade"
            />
            <Stat
              label={paceEstimated ? "Pace spend · est." : "Projected pace spend"}
              value={`−${formatCurrency(paceSpend)}`}
              tone="coral"
            />
          </StatStrip>
        </div>

        {/* Actual-vs-projected balance chart. */}
        <div className="flex min-w-0 flex-[1.4_1_420px] flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow">Balance forecast · {monthName}</h2>
            <span className="flex gap-4 text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3.5 bg-[var(--jade)]" />
                Actual
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="w-3.5 border-t-2 border-dashed border-[var(--brass)]" />
                Forecast
              </span>
            </span>
          </div>
          <ForecastChart data={series} today={today} />
          <p className="mono text-xs text-[var(--muted)]">
            {formatCurrency(currentCash)} today − {formatCurrency(remainingBills)} bills −{" "}
            {formatCurrency(paceSpend)} pace spend + {formatCurrency(remainingIncome)} income ={" "}
            <span className={negative ? "text-[var(--coral)]" : "text-[var(--paper)]"}>
              {formatCurrency(projectedEndBalance)}
            </span>{" "}
            projected over {daysInMonth} days
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-x-12 gap-y-9">
        <div className="flex min-w-0 flex-[3_1_520px] flex-col gap-9">
          <section aria-label="Bills still to clear">
            <SectionHead
              title="Bills still to clear"
              count={formatCurrency(billsTotal)}
              action={
                <Link
                  href="/plan?tab=bills"
                  className="text-[13px] text-[var(--muted)] hover:text-[var(--paper)]"
                >
                  All recurring
                </Link>
              }
            />
            {bills.length === 0 ? (
              <Quiet>None predicted for the rest of {monthName}.</Quiet>
            ) : (
              <Rows>
                {bills.map((r) => (
                  <StreamRow key={r.id} row={r} today={todayStr} showDue />
                ))}
              </Rows>
            )}
          </section>

          <section aria-label="Income still to land">
            <SectionHead title="Income still to land" count={formatCurrency(incomeTotal)} />
            {income.length === 0 ? (
              <Quiet>None predicted for the rest of {monthName}.</Quiet>
            ) : (
              <Rows>
                {income.map((r) => (
                  <StreamRow key={r.id} row={r} today={todayStr} />
                ))}
              </Rows>
            )}
          </section>

          <section aria-label="Next month and unconfirmed">
            <SectionHead
              title={`Upcoming after ${monthName}`}
              action={
                laterAll.length > later.length ? (
                  <Link
                    href="/plan?tab=bills"
                    className="text-[13px] text-[var(--muted)] hover:text-[var(--paper)]"
                  >
                    {laterAll.length - later.length} more
                  </Link>
                ) : undefined
              }
            />
            {later.length === 0 && awaiting.length === 0 ? (
              <Quiet>Nothing is predicted past {monthName} yet.</Quiet>
            ) : (
              <>
                {later.length > 0 && (
                  <Rows>
                    {later.map((r) => (
                      <StreamRow key={r.id} row={r} today={todayStr} />
                    ))}
                  </Rows>
                )}
                {awaiting.map((r) => (
                  <AwaitingRow key={r.id} row={r} today={todayStr} />
                ))}
              </>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-[2_1_300px] flex-col gap-9">
          <GoalsSummary goals={goals} />
          <FireSummary fire={fire} />
        </div>
      </div>
    </div>
  );
}

const ROW = "grid grid-cols-[56px_minmax(0,1.4fr)_minmax(0,1fr)_110px] items-center gap-4";

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <ul className="min-w-[440px]">{children}</ul>
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="border-b border-line py-3.5 text-[13px] text-[var(--muted)]">{children}</p>;
}

/** One predicted occurrence: date · name · cadence (and how soon) · amount. */
function StreamRow({
  row,
  today,
  showDue = false,
}: {
  row: RecurringRow;
  today: string;
  showDue?: boolean;
}) {
  const income = row.direction === "inflow";
  const due = showDue ? dueIn(row.predictedNextDate, today) : "";
  const until = row.predictedNextDate ? daysUntil(row.predictedNextDate, today) : null;
  const soon = showDue && until != null && until <= 7;
  return (
    <li className={`${ROW} min-h-12 border-b border-line`}>
      <span className="mono text-xs text-[var(--muted)]">
        {row.predictedNextDate ? format(parseISO(row.predictedNextDate), "MMM d") : "—"}
      </span>
      <span className="truncate font-medium">{streamLabel(row).name}</span>
      <span className={`truncate text-[13px] ${soon ? "text-[var(--brass)]" : "text-[var(--muted)]"}`}>
        {cadenceLabel(row.frequency)}
        {due && ` · ${due}`}
      </span>
      <span className={`mono text-right ${income ? "text-[var(--jade)]" : ""}`}>
        {formatCurrency(Math.abs(row.averageAmount ?? 0), row.currency ?? "USD")}
      </span>
    </li>
  );
}

/** A bill whose predicted date has passed with no matching charge seen yet. */
function AwaitingRow({ row, today }: { row: RecurringRow; today: string }) {
  const late = daysLate(row.predictedNextDate, today);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-3">
      <div className="min-w-0 flex-[1_1_260px]">
        <p className="font-medium">
          {streamLabel(row).name}{" "}
          <span className="mono font-normal text-[var(--muted)]">
            {formatCurrency(Math.abs(row.averageAmount ?? 0), row.currency ?? "USD")}
          </span>
        </p>
        <p className="text-[13px] text-[var(--brass)]">
          Awaiting confirmation
          {row.predictedNextDate && (
            <>
              {" · expected "}
              {format(parseISO(row.predictedNextDate), "MMM d")}, no charge yet ({late} day
              {late === 1 ? "" : "s"} late)
            </>
          )}
        </p>
      </div>
      <Link
        href="/plan?tab=bills"
        className="inline-flex min-h-9 items-center rounded-full border border-line px-3.5 text-[13px] text-[var(--muted)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
      >
        Open in Bills &amp; income
      </Link>
    </div>
  );
}

function GoalsSummary({ goals }: { goals: SavingsGoalRow[] }) {
  const saved = goals.reduce((s, g) => s + g.saved, 0);
  const target = goals.reduce((s, g) => s + g.targetAmount, 0);
  return (
    <section aria-label="Goals">
      <SectionHead
        title="Goals"
        action={
          <Link
            href="/budgets#goals"
            className="text-[13px] text-[var(--muted)] hover:text-[var(--paper)]"
          >
            All goals · new goal
          </Link>
        }
      />
      {goals.length === 0 ? (
        <Quiet>No savings goals yet.</Quiet>
      ) : (
        <>
          <p className="mb-1 mt-3.5 text-[13px] text-[var(--muted)]">
            Total earmarked <span className="mono text-[var(--paper)]">{formatCurrency(saved)}</span>
            {target > 0 && (
              <>
                {" "}
                of {formatCurrency(target)} across {goals.length} goal
                {goals.length === 1 ? "" : "s"} · {Math.floor(Math.min(1, saved / target) * 100)}%
              </>
            )}
          </p>
          <ul>
            {goals.map((g) => {
              const behind =
                !!g.targetDate && g.saved < g.targetAmount && g.targetDate < todayIso();
              return (
                <li key={g.id} className="flex flex-col gap-2 border-b border-line py-3.5">
                  <div className="flex justify-between gap-3">
                    <span className="truncate font-medium">{g.name}</span>
                    <span className="mono shrink-0 text-[13px]">
                      {formatCurrency(g.saved)}
                      <span className="text-[var(--muted)]"> of {formatCurrency(g.targetAmount)}</span>
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                    <div
                      className={`h-full rounded-full ${behind ? "bg-[var(--coral)]" : "bg-[var(--jade)]"}`}
                      style={{ width: `${Math.max(g.pct, g.saved > 0 ? 2 : 0)}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`text-xs ${behind ? "text-[var(--coral)]" : "text-[var(--muted)]"}`}
                    >
                      {g.targetDate
                        ? `${behind ? "Past due · " : "Target "}${format(parseISO(g.targetDate), "MMMM d, yyyy")}`
                        : "No target date"}
                    </span>
                    <span className="flex gap-1.5">
                      <GoalContributeButton goal={g} kind="deposit" />
                      <GoalContributeButton goal={g} kind="withdraw" />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function FireSummary({ fire }: { fire: ReturnType<typeof getFireMetrics> }) {
  const pct = fire.fireProgress == null ? null : Math.min(1, Math.max(0, fire.fireProgress));
  return (
    <section aria-label="Financial independence">
      <SectionHead
        title="FIRE"
        action={
          <Link
            href="/plan?tab=long-run"
            className="text-[13px] text-[var(--muted)] hover:text-[var(--paper)]"
          >
            Assumptions · milestones
          </Link>
        }
      />
      {fire.fireNumber > 0 && pct != null ? (
        <div className="flex flex-col gap-2 py-3.5">
          <div className="flex justify-between gap-3">
            <span>Progress to financial independence</span>
            <span className="mono text-[var(--brass)]">{(pct * 100).toFixed(1)}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
            <div
              className="h-full rounded-full bg-[var(--brass)]"
              style={{ width: `${Math.max(pct * 100, fire.netWorth > 0 ? 2 : 0)}%` }}
            />
          </div>
          <span className="text-xs text-[var(--muted)]">
            {formatCurrency(fire.netWorth, undefined, { maximumFractionDigits: 0 })} of a{" "}
            {formatCurrency(fire.fireNumber, undefined, { maximumFractionDigits: 0 })} FIRE number ·{" "}
            {fire.settings.safeWithdrawalRate}% withdrawal on{" "}
            {fire.annualExpensesDerived ? "an estimated " : ""}
            {formatCompactCurrency(fire.annualExpenses)} a year
          </span>
        </div>
      ) : (
        <Quiet>Set your annual expenses on Long run to compute a FIRE number.</Quiet>
      )}
    </section>
  );
}

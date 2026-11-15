import { format, parseISO } from "date-fns";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ForecastChart } from "@/components/charts";
import { DataFreshnessBanner } from "@/components/data-freshness";
import { getDataFreshness } from "@/lib/data-freshness";
import { Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import { getCashflowForecast, getForecastSeries, getRemainingRecurring } from "@/lib/forecast";
import { forecastVerdict } from "@/lib/forecast-verdict";
import { streamLabel } from "@/lib/recurring";
import { formatCurrency } from "@/lib/utils";

/** Forecast tab of /plan — the old /cashflow page, minus its bill/income
 * lists (the Bills & income tab owns those now). */
export function ForecastTab() {
  const forecast = getCashflowForecast();
  const series = getForecastSeries(forecast.month);
  const { bills } = getRemainingRecurring(forecast.month);

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
  const verdict = forecastVerdict({
    currentCash,
    projectedEndBalance,
    daysRemaining: forecast.daysRemaining,
  });

  return (
    <div className="space-y-7">
      <p className="max-w-xl text-sm text-[var(--muted)]">
        Where your cash lands by the end of {monthLabel} — current balances, the bills and income
        still to clear, and your discretionary spending pace.
      </p>

      <DataFreshnessBanner freshness={freshness} />

      {/* The month's one figure is where cash lands; the sentence says how far
          that is from today, and the rule under it holds the four figures the
          projection is made of. */}
      <section className="space-y-5" aria-label={`${monthLabel} cash forecast`}>
        <Hero
          eyebrow={`Projected end of ${format(parseISO(`${month}-01`), "MMMM")}`}
          figure={formatCurrency(projectedEndBalance)}
          tone={negative ? "coral" : "default"}
          verdict={
            <>
              {verdict.lead} <Mark tone={verdict.tone}>{formatCurrency(verdict.amount)}</Mark>{" "}
              {verdict.tail}
            </>
          }
        />
        <StatStrip>
          <Stat
            label={asOfLabel && balanceStale ? `Cash · as of ${asOfLabel}` : "Cash today"}
            value={formatCurrency(currentCash)}
          />
          <Stat label="Bills remaining" value={formatCurrency(remainingBills)} tone="coral" />
          <Stat label="Income remaining" value={formatCurrency(remainingIncome)} tone="jade" />
          <Stat
            label={paceEstimated ? "Pace spend · est." : "Projected pace spend"}
            value={formatCurrency(paceSpend)}
            tone="coral"
          />
        </StatStrip>
      </section>

      {(willOverdraft || showLowNote) && lowest && (
        <div
          className={`flex items-start gap-3 border-l-2 py-1 pl-4 text-sm ${
            willOverdraft
              ? "border-[var(--coral)] text-[var(--coral)]"
              : "border-[var(--line-strong)] text-[var(--muted)]"
          }`}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {willOverdraft ? (
              <>
                Cash is projected to dip to{" "}
                <span className="font-medium">{formatCurrency(lowest.amount)}</span> on{" "}
                {format(parseISO(lowest.date), "MMM d")} before month-end — watch for an overdraft
                around then.
              </>
            ) : (
              <>
                Lowest projected point this month:{" "}
                <span className="font-medium text-[var(--paper)]">
                  {formatCurrency(lowest.amount)}
                </span>{" "}
                on {format(parseISO(lowest.date), "MMM d")}.
              </>
            )}
          </span>
        </div>
      )}

      {/* Actual-vs-projected balance chart. */}
      <section className="space-y-4">
        <SectionHead
          title={`Balance forecast · ${monthLabel}`}
          action={
            <span className="flex items-center gap-3 text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--jade)" }} />
                Actual
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-px w-3 border-t border-dashed border-[var(--brass)]" />
                Projected
              </span>
            </span>
          }
        />
        <ForecastChart data={series} today={today} />
        <p className="mono border-t border-line pt-3 text-xs text-[var(--muted)]">
          {formatCurrency(currentCash)} today − {formatCurrency(remainingBills)} bills −{" "}
          {formatCurrency(paceSpend)} pace spend + {formatCurrency(remainingIncome)} income ={" "}
          <span className={negative ? "text-[var(--coral)]" : "text-[var(--paper)]"}>
            {formatCurrency(projectedEndBalance)}
          </span>{" "}
          projected over {daysInMonth} days
        </p>
      </section>

      {/* A glance at what clears next; the full list lives one tab over. */}
      <NextBills bills={bills} />
    </div>
  );
}

function NextBills({ bills }: { bills: ReturnType<typeof getRemainingRecurring>["bills"] }) {
  const next = [...bills]
    .filter((b) => b.predictedNextDate)
    .sort((a, b) => (a.predictedNextDate! < b.predictedNextDate! ? -1 : 1))
    .slice(0, 3);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-3.5 text-sm">
      <span className="eyebrow">Next bills</span>
      {next.length === 0 ? (
        <span className="text-[var(--muted)]">None predicted for the rest of the month.</span>
      ) : (
        next.map((b) => (
          <span key={b.id} className="flex items-baseline gap-1.5">
            <span className="mono text-xs text-[var(--muted)]">
              {format(parseISO(b.predictedNextDate!), "MMM d")}
            </span>
            <span className="truncate">{streamLabel(b).name}</span>
            <span className="mono text-[var(--coral)]">
              {formatCurrency(Math.abs(b.averageAmount ?? 0), b.currency ?? "USD")}
            </span>
          </span>
        ))
      )}
      <Link href="/plan?tab=bills" className="ml-auto text-xs text-[var(--brass)] hover:underline">
        All bills &amp; income →
      </Link>
    </div>
  );
}

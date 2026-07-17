import { format, parseISO } from "date-fns";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { ForecastChart } from "@/components/charts";
import { Card } from "@/components/ui/card";
import { getCashflowForecast, getForecastSeries, getRemainingRecurring } from "@/lib/forecast";
import type { RecurringRow } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function CashflowPage() {
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

  return (
    <div className="space-y-7">
      <PageHead title="Cashflow" />
      <p className="-mt-3 max-w-xl text-sm text-[var(--muted)]">
        Where your cash lands by the end of {monthLabel} — current balances, the bills and income
        still to clear, and your discretionary spending pace.
      </p>

      {/* Hero: projected end-of-month balance + supporting stats. */}
      <div className="flex flex-col gap-6 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Projected end of {format(parseISO(`${month}-01`), "MMMM")}</p>
            <p
              className={`display-1 mt-2 font-display text-5xl tabular ${negative ? "text-[var(--coral)]" : ""}`}
            >
              {formatCurrency(projectedEndBalance)}
            </p>
            <p className="mt-3 text-sm text-[var(--muted)]">
              {forecast.daysRemaining > 0
                ? `${forecast.daysRemaining} day${forecast.daysRemaining === 1 ? "" : "s"} left · ${formatCurrency(currentCash)} in cash today`
                : `Month closed · ${formatCurrency(currentCash)} in cash`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          <Stat label="Cash today" value={formatCurrency(currentCash)} />
          <Stat label="Bills remaining" value={formatCurrency(remainingBills)} tone="coral" />
          <Stat label="Income remaining" value={formatCurrency(remainingIncome)} tone="jade" />
          <Stat
            label={paceEstimated ? "Pace spend · est." : "Projected pace spend"}
            value={formatCurrency(paceSpend)}
            tone="coral"
          />
        </div>
      </div>

      {(willOverdraft || showLowNote) && lowest && (
        <div
          className={`flex items-start gap-3 rounded-[var(--radius)] border px-5 py-4 text-sm ${
            willOverdraft
              ? "border-[var(--coral)] bg-[var(--panel)] text-[var(--coral)]"
              : "border-line bg-[var(--panel)] text-[var(--muted)]"
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
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="eyebrow">Balance forecast · {monthLabel}</span>
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
        </div>
        <div className="px-3 py-5 sm:px-5">
          <ForecastChart data={series} today={today} />
        </div>
        <div className="border-t border-line px-6 py-3 text-xs text-[var(--muted)]">
          {formatCurrency(currentCash)} today − {formatCurrency(remainingBills)} bills −{" "}
          {formatCurrency(paceSpend)} pace spend + {formatCurrency(remainingIncome)} income ={" "}
          <span className={negative ? "text-[var(--coral)]" : "text-[var(--paper)]"}>
            {formatCurrency(projectedEndBalance)}
          </span>{" "}
          projected over {daysInMonth} days
        </div>
      </Card>

      {/* Remaining recurring bills & income for the month. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RecurringList
          title="Bills still to clear"
          rows={bills}
          tone="coral"
          icon={<ArrowUpRight size={14} />}
          empty="No bills predicted for the rest of the month."
        />
        <RecurringList
          title="Income still to land"
          rows={income}
          tone="jade"
          icon={<ArrowDownLeft size={14} />}
          empty="No income predicted for the rest of the month."
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "coral" | "jade";
}) {
  const color =
    tone === "coral" ? "text-[var(--coral)]" : tone === "jade" ? "text-[var(--jade)]" : "";
  return (
    <div className="bg-[var(--panel)] px-4 py-3.5">
      <p className="eyebrow">{label}</p>
      <p className={`mt-1.5 font-display text-lg leading-none tabular ${color}`}>{value}</p>
    </div>
  );
}

function RecurringList({
  title,
  rows,
  tone,
  icon,
  empty,
}: {
  title: string;
  rows: RecurringRow[];
  tone: "coral" | "jade";
  icon: React.ReactNode;
  empty: string;
}) {
  const total = rows.reduce((s, r) => s + Math.abs(r.averageAmount ?? 0), 0);
  const color = tone === "coral" ? "text-[var(--coral)]" : "text-[var(--jade)]";
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <span className="flex items-center gap-2 eyebrow">
          <span className={color}>{icon}</span>
          {title}
        </span>
        {rows.length > 0 && (
          <span className={`mono text-sm ${color}`}>{formatCurrency(total)}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="px-2 py-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--panel-2)]"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-center">
                <span className="mono text-[10px] uppercase leading-none text-[var(--muted)]">
                  {r.predictedNextDate && format(parseISO(r.predictedNextDate), "MMM")}
                </span>
                <span className="font-display text-sm leading-none">
                  {r.predictedNextDate && format(parseISO(r.predictedNextDate), "d")}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {r.merchantName ?? r.description ?? "Recurring"}
                </p>
                <p className="truncate text-xs text-[var(--muted)]">{r.accountName}</p>
              </div>
              <span className="mono shrink-0 text-sm">
                {formatCurrency(Math.abs(r.averageAmount ?? 0), r.currency ?? "USD")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

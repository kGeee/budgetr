"use client";

import { useMemo } from "react";
import { CalendarClock, Coins, PiggyBank, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MonthlySpendChart } from "@/components/charts";
import { formatCurrency } from "@/lib/utils";
import type { DividendSummary } from "@/lib/dividends";
import type { DividendCalendarEntry } from "@/lib/yahoo";

/**
 * Dividend income section for the portfolio page. Renders three headline stats
 * (trailing-12m income, projected forward annual income, portfolio yield-on-cost),
 * a monthly income bar chart, a per-ticker table (income · yield-on-cost ·
 * projected annual), and an upcoming ex-dividend calendar sourced from Yahoo.
 *
 * All figures are derived server-side (lib/dividends.ts) and passed in; this is a
 * presentational client component so it can share the page's chart wrappers.
 */
export function DividendPanel({
  summary,
  calendar = [],
}: {
  summary: DividendSummary;
  calendar?: DividendCalendarEntry[];
}) {
  // Trailing 24 months of income keep the bar chart legible on long histories.
  const monthly = useMemo(
    () => summary.byMonth.slice(-24).map((m) => ({ month: m.month, spent: m.amount })),
    [summary.byMonth],
  );

  // Upcoming ex-dividend dates for held tickers, soonest first. Past dates drop
  // out so the calendar always looks forward.
  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return calendar
      .filter((c) => c.exDividendDate && c.exDividendDate >= today)
      .sort((a, b) => (a.exDividendDate ?? "").localeCompare(b.exDividendDate ?? ""));
  }, [calendar]);

  if (summary.payments.length === 0) return null;

  const currency = summary.byTicker[0]?.currency ?? "USD";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <DividendStat
          icon={<Coins size={15} />}
          label="Income · trailing 12 mo"
          value={formatCurrency(summary.trailing12mTotal, currency)}
          sub={`${formatCurrency(summary.lifetimeTotal, currency)} lifetime`}
        />
        <DividendStat
          icon={<TrendingUp size={15} />}
          label="Projected · forward annual"
          value={formatCurrency(summary.projectedAnnualTotal, currency)}
          sub={`≈ ${formatCurrency(summary.projectedAnnualTotal / 12, currency)}/mo run-rate`}
          accent="jade"
        />
        <DividendStat
          icon={<PiggyBank size={15} />}
          label="Portfolio yield on cost"
          value={
            summary.portfolioYieldOnCost != null
              ? `${summary.portfolioYieldOnCost.toFixed(2)}%`
              : "—"
          }
          sub="trailing income ÷ cost basis"
          accent="brass"
        />
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="eyebrow">Dividend income by month</span>
          <span className="text-xs text-[var(--faint)]">cash distributions from your ledger</span>
        </div>
        <div className="px-3 py-5 sm:px-5">
          <MonthlySpendChart data={monthly} />
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="eyebrow">Income by position</span>
          <span className="text-xs text-[var(--muted)]">
            {summary.byTicker.length} {summary.byTicker.length === 1 ? "payer" : "payers"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Ticker", "Trailing 12 mo", "Yield on cost", "Projected / yr", "Last paid"].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`px-6 py-2.5 eyebrow font-medium ${i >= 1 ? "text-right" : ""}`}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {summary.byTicker.map((t) => (
                <tr key={t.ticker} className="border-b border-line/60 last:border-0">
                  <td className="px-6 py-2.5">
                    <span className="font-medium text-[var(--brass)]">{t.ticker}</span>
                    {t.name && <span className="ml-2 text-[var(--muted)]">{t.name}</span>}
                  </td>
                  <td className="mono px-6 py-2.5 text-right">
                    {formatCurrency(t.trailing12m, t.currency)}
                    <span className="ml-1.5 text-[10px] text-[var(--faint)]">
                      ×{t.count12m}
                    </span>
                  </td>
                  <td className="mono px-6 py-2.5 text-right">
                    {t.yieldOnCost != null ? (
                      <span className="text-[var(--jade)]">{t.yieldOnCost.toFixed(2)}%</span>
                    ) : (
                      <span className="text-[var(--faint)]">—</span>
                    )}
                  </td>
                  <td className="mono px-6 py-2.5 text-right text-[var(--muted)]">
                    {t.projectedAnnual > 0 ? formatCurrency(t.projectedAnnual, t.currency) : "—"}
                  </td>
                  <td className="mono px-6 py-2.5 text-right text-[var(--muted)]">
                    {t.lastPaid ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="inline-flex items-center gap-2">
            <CalendarClock size={13} className="text-[var(--brass)]" />
            <span className="eyebrow">Upcoming ex-dividend dates</span>
          </span>
          <span className="text-xs text-[var(--faint)]">from Yahoo Finance</span>
        </div>
        {upcoming.length > 0 ? (
          <ul className="divide-y divide-line/60">
            {upcoming.map((c) => (
              <li
                key={c.symbol}
                className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5"
              >
                <span className="inline-flex items-center gap-3">
                  <span className="font-medium text-[var(--brass)]">{c.symbol}</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--jade)]/12 px-2.5 py-0.5 text-xs text-[var(--jade)]">
                    ex-div {c.exDividendDate}
                  </span>
                  {c.payDate && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brass)]/12 px-2.5 py-0.5 text-xs text-[var(--brass)]">
                      pays {c.payDate}
                    </span>
                  )}
                </span>
                <span className="mono text-xs text-[var(--muted)]">
                  {c.rate != null && `${formatCurrency(c.rate, currency)}/yr`}
                  {c.yield != null && (
                    <span className="ml-2 text-[var(--faint)]">{c.yield.toFixed(2)}%</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-6 py-8 text-center text-sm text-[var(--muted)]">
            No upcoming ex-dividend dates for your holdings.
          </p>
        )}
      </Card>
    </div>
  );
}

function DividendStat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent?: "jade" | "brass";
}) {
  const color =
    accent === "jade"
      ? "text-[var(--jade)]"
      : accent === "brass"
        ? "text-[var(--brass)]"
        : "text-[var(--paper)]";
  return (
    <Card>
      <div className="flex items-center gap-2 text-[var(--faint)]">
        {icon}
        <p className="eyebrow">{label}</p>
      </div>
      <p className={`mt-2 font-display text-3xl tabular ${color}`}>{value}</p>
      <p className="mono mt-1 text-xs text-[var(--muted)]">{sub}</p>
    </Card>
  );
}

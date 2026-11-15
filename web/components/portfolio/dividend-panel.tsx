"use client";

import { useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Bar, ruled } from "@/components/portfolio/ruled";
import { MonthlySpendChart } from "@/components/charts";
import { formatCurrency } from "@/lib/utils";
import type { DividendSummary } from "@/lib/dividends";
import type { DividendCalendarEntry } from "@/lib/yahoo";

/**
 * Dividend income section of Investments › Income & gains. A ruled head with
 * the headline figures (trailing-12m income, yield-on-cost, lifetime), then
 * three columns: the monthly income bars, the leading payers, and the upcoming
 * ex-dividend calendar from Yahoo. The full per-ticker table (income · share ·
 * yield-on-cost · projected annual · last paid, plus lapsed payers) opens under
 * the payer list.
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

  /**
   * A position that paid nothing in the last twelve months is history, not a
   * payer. Four of this account's "28 payers" last paid in 2024 and show
   * "$0.00 ×0" — counting them inflates the roster and pads the table with rows
   * that carry no information.
   */
  const { active, lapsed } = useMemo(() => {
    const active = summary.byTicker.filter((t) => t.count12m > 0 || t.trailing12m > 0);
    return { active, lapsed: summary.byTicker.filter((t) => !active.includes(t)) };
  }, [summary.byTicker]);

  const [showLapsed, setShowLapsed] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const rows = showLapsed ? [...active, ...lapsed] : active;

  // Share of trailing income, for the concentration bars. SPY is 38% of this
  // account's dividend income — a fact the table made you compute.
  const topIncome = active[0]?.trailing12m ?? 0;

  if (summary.payments.length === 0) return null;

  const currency = summary.byTicker[0]?.currency ?? "USD";

  const topShare =
    active[0] && summary.trailing12mTotal > 0
      ? Math.round((active[0].trailing12m / summary.trailing12mTotal) * 100)
      : null;
  // The side list names the payers that carry the income; the full table with
  // every column is one click below it.
  const leaders = active.slice(0, 6);

  return (
    <section aria-label="Dividends" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--line-strong)] pb-2.5">
        <h2 className="font-display text-lg tracking-tight">
          Dividend income{" "}
          <span className="font-sans text-xs font-normal tracking-normal text-[var(--muted)]">
            trailing 12 months
          </span>
        </h2>
        <span className="mono text-sm">
          {formatCurrency(summary.trailing12mTotal, currency)}
          <span className="text-[var(--muted)]">
            {" · "}
            <span title="Trailing income ÷ cost basis">
              {summary.portfolioYieldOnCost != null
                ? `${summary.portfolioYieldOnCost.toFixed(2)}% yield on cost`
                : "no yield on cost yet"}
            </span>
            {" · "}
            {formatCurrency(summary.lifetimeTotal, currency)} lifetime
          </span>
        </span>
      </div>

      <p className="text-sm text-[var(--muted)]">
        On pace for{" "}
        <span className="mono text-[var(--jade)]">
          {formatCurrency(summary.projectedAnnualTotal, currency)}
        </span>{" "}
        next year — about {formatCurrency(summary.projectedAnnualTotal / 12, currency)} a month,
        from {active.length} paying {active.length === 1 ? "position" : "positions"}.
      </p>

      <div className="flex flex-wrap gap-x-12 gap-y-6">
        <div className="flex min-w-0 flex-[3_1_420px] flex-col gap-2">
          <span className="text-xs text-[var(--muted)]">
            Dividend income by month · cash distributions from your ledger
          </span>
          <MonthlySpendChart data={monthly} />
        </div>

        <div className="flex min-w-0 flex-[1_1_240px] flex-col">
          <span className="pb-1.5 text-xs text-[var(--muted)]">Income by position</span>
          {leaders.map((t, i) => (
            <div
              key={t.ticker}
              className="mono flex min-h-10 items-center justify-between gap-3 border-b border-line text-[13px]"
            >
              <span className="font-medium">
                {t.ticker}
                {i === 0 && (
                  <span className="ml-2 font-sans text-xs font-normal text-[var(--brass)]">
                    Top payer{topShare != null && ` · ${topShare}%`}
                  </span>
                )}
              </span>
              <span>{formatCurrency(t.trailing12m, t.currency)}</span>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            className="mt-2.5 self-start text-xs text-[var(--brass)] transition-colors hover:text-[var(--paper)]"
          >
            {showTable
              ? "Hide the full table"
              : `All ${active.length} ${active.length === 1 ? "payer" : "payers"} · yield, projection, last paid`}
          </button>
        </div>

        {/* Rendered only when Yahoo actually returned dates. An empty state that
            appears on every single load is a permanent fixture, not an empty
            state — it trains you to ignore the panel. */}
        {upcoming.length > 0 && (
          <div className="flex min-w-0 flex-[1_1_220px] flex-col">
            <span className="flex items-center gap-1.5 pb-1.5 text-xs text-[var(--muted)]">
              <CalendarClock size={13} className="text-[var(--brass)]" />
              Upcoming ex-dividend dates · Yahoo Finance
            </span>
            {upcoming.map((c) => (
              <div key={c.symbol} className="mono border-b border-line py-2.5 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{c.symbol}</span>
                  <span className="text-[var(--muted)]">{c.exDividendDate}</span>
                </div>
                {(c.payDate || c.rate != null || c.yield != null) && (
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {[
                      c.payDate && `pays ${c.payDate}`,
                      c.rate != null && `${formatCurrency(c.rate, currency)}/yr`,
                      c.yield != null && `${c.yield.toFixed(2)}%`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showTable && (
        <div className="space-y-2 pt-2">
          <div className="flex items-baseline justify-between gap-3 text-xs text-[var(--muted)]">
            <span>
              {active.length} {active.length === 1 ? "payer" : "payers"}
            </span>
            {lapsed.length > 0 && (
              <button
                onClick={() => setShowLapsed((v) => !v)}
                className="text-[var(--brass)] transition-colors hover:text-[var(--paper)]"
              >
                {showLapsed ? "hide lapsed" : `${lapsed.length} lapsed`}
              </button>
            )}
          </div>
          <div className={ruled.scroll}>
            <table className={`${ruled.table} min-w-[640px]`}>
              <thead>
                <tr className={ruled.headRow}>
                  {["Ticker", "Trailing 12 mo", "Share", "Yield on cost", "Projected / yr", "Last paid"].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`${ruled.th} ${i >= 1 && i !== 2 ? "text-right" : ""}`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const dormant = t.count12m === 0 && t.trailing12m === 0;
                  return (
                    <tr key={t.ticker} className={`${ruled.row} ${dormant ? "opacity-60" : ""}`}>
                      <td className={ruled.td}>
                        <span className="mono font-medium">{t.ticker}</span>
                        {t.name && <span className="ml-2.5 text-[13px] text-[var(--muted)]">{t.name}</span>}
                        {dormant && (
                          <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                            lapsed
                          </span>
                        )}
                      </td>
                      <td className={`${ruled.td} ${ruled.num}`}>
                        {formatCurrency(t.trailing12m, t.currency)}
                        <span className="ml-1.5 text-[10px] text-[var(--muted)]">×{t.count12m}</span>
                      </td>
                      {/* Concentration at a glance: one payer carrying most of the
                          income is the thing worth noticing here. */}
                      <td className={`${ruled.td} w-32`}>
                        <Bar pct={topIncome > 0 ? Math.max(2, (t.trailing12m / topIncome) * 100) : 0} />
                      </td>
                      <td className={`${ruled.td} ${ruled.num}`}>
                        {t.yieldOnCost != null ? (
                          <span className="text-[var(--jade)]">{t.yieldOnCost.toFixed(2)}%</span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>
                        {t.projectedAnnual > 0 ? formatCurrency(t.projectedAnnual, t.currency) : "—"}
                      </td>
                      <td className={`${ruled.td} ${ruled.num} text-[var(--muted)]`}>
                        {t.lastPaid ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

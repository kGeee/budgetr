import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import { CategoryChart, MonthlySpendChart, NetWorthChart } from "@/components/charts";
import { CategoryIcon } from "@/components/budget/category-pill";
import { SpendHeatmap } from "@/components/budget/spend-heatmap";
import { ReportPrintButton } from "@/components/report-print-button";
import {
  buildReportData,
  formatReportMoney,
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  type ReportPeriod,
} from "@/lib/report";
import { spendingVerdict } from "@/lib/spending-verdict";
import { spendingHref } from "./href";

/**
 * Spending → report mode (?report=1): the printable period report, meant to be
 * saved as a PDF or emailed. The `report-page` container is the print root —
 * the `@media print` rules in globals.css hide the app chrome (`.no-print`) and
 * reset page padding so only this content lands on paper.
 */
export function ReportView({
  period,
  rawCurrency,
}: {
  period: ReportPeriod;
  /** ?currency= override; the persisted display currency when absent. */
  rawCurrency?: string;
}) {
  const data = buildReportData(period, rawCurrency);
  const cur = data.currency;
  const money = (v: number) => formatReportMoney(v, cur);

  const q = (p: string) =>
    spendingHref({ report: true, period: p, currency: rawCurrency ? cur : undefined });
  const topVendor = data.topVendors[0];
  const verdict = spendingVerdict(data.totals);

  return (
    <div className="report-page mx-auto max-w-[900px] space-y-7 py-2">
      {/* Header — hidden from print via .no-print, replaced by the printed title below. */}
      <div className="no-print flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <Link
            href={spendingHref({ period })}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
          >
            <ArrowLeft size={14} /> Spending
          </Link>
          <p className="eyebrow">Printable report</p>
          <h1 className="mt-1.5 font-display text-3xl leading-none tracking-tight sm:text-4xl">
            {data.label} in review
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {REPORT_PERIODS.map((p) => {
            const active = p === period;
            return (
              <Link
                key={p}
                href={q(p)}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                    : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
                }`}
              >
                {REPORT_PERIOD_LABELS[p]}
              </Link>
            );
          })}
          <span className="mx-1 h-5 w-px bg-line" />
          <ReportPrintButton />
        </div>
      </div>

      {/* Print-only masthead. */}
      <div className="print-only mb-4">
        <p className="eyebrow text-[var(--brass)]">budgetr · {REPORT_PERIOD_LABELS[period]}</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight">{data.label} in review</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Generated {format(parseISO(data.generatedAt), "PPpp")} · figures in {cur}
        </p>
      </div>

      {/* Hero — the period's one figure, the sentence that reads it, then the
          figures it is made of on a single rule. */}
      <section className="break-avoid space-y-5">
        {data.empty ? (
          <>
            <p className="eyebrow">{data.label} summary</p>
            <p className="text-[var(--muted)]">Nothing recorded for {data.label} yet.</p>
          </>
        ) : (
          <>
            <Hero
              eyebrow={`Total spent · ${data.label} summary`}
              figure={money(data.totals.expenses)}
              verdict={
                verdict && (
                  <>
                    {verdict.lead} <Mark tone={verdict.tone}>{money(verdict.amount)}</Mark>{" "}
                    {verdict.tail}
                  </>
                )
              }
            >
              {topVendor && (
                <p className="max-w-[60ch] text-sm text-[var(--muted)]">
                  Top vendor was{" "}
                  <span className="font-medium text-[var(--paper)]">{topVendor.vendor}</span> at{" "}
                  <span className="mono text-[var(--paper)]">{money(topVendor.total)}</span> over{" "}
                  {topVendor.count} visit{topVendor.count === 1 ? "" : "s"}.
                </p>
              )}
            </Hero>
            <StatStrip>
              <Stat label="Income" value={money(data.totals.income)} tone="jade" />
              <Stat
                label="Net"
                value={`${data.totals.net >= 0 ? "+" : "−"}${money(Math.abs(data.totals.net))}`}
                tone={data.totals.net >= 0 ? "jade" : "coral"}
              />
              <Stat label="Net worth" value={money(data.netWorthCurrent)} />
              <Stat label="Transactions" value={data.totals.txCount.toLocaleString()} />
            </StatStrip>
          </>
        )}
      </section>

      {/* Net worth over time. */}
      <section className="break-avoid space-y-4">
        <SectionHead title="Net worth" />
        <NetWorthChart data={data.netWorth} />
      </section>

      {/* Daily-spend calendar — trailing year. */}
      <section className="break-avoid space-y-4">
        <SectionHead title="Daily spend · trailing year" />
        <SpendHeatmap
          data={data.heatmap}
          start={data.heatmapStart}
          end={data.heatmapEnd}
          categories={data.categoryMeta}
        />
      </section>

      {/* Top vendors + biggest purchases. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="break-avoid space-y-3">
          <SectionHead title="Top vendors" />
          {data.topVendors.length > 0 ? (
            <ul className="space-y-1">
              {data.topVendors.map((v, i) => (
                <li key={v.vendor} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <span className="mono w-5 shrink-0 text-center text-xs text-[var(--muted)]">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{v.vendor}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {v.count} transaction{v.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="mono shrink-0 text-sm text-[var(--paper)]">{money(v.total)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Blank>No vendor spend in this period.</Blank>
          )}
        </section>

        <section className="break-avoid space-y-3">
          <SectionHead title="Biggest purchases" />
          {data.biggest.length > 0 ? (
            <ul className="space-y-1">
              {data.biggest.map((b) => (
                <li key={b.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-[var(--brass)]">
                    <CategoryIcon icon={b.categoryIcon} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{b.vendor}</p>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {b.categoryName} · {format(parseISO(b.date), "MMM d")}
                    </p>
                  </div>
                  <span className="mono shrink-0 text-sm text-[var(--paper)]">{money(b.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Blank>No purchases in this period.</Blank>
          )}
        </section>
      </div>

      {/* Category shifts vs prior period. */}
      <section className="break-avoid space-y-2">
        <SectionHead title={`Category shifts · vs ${data.prevLabel}`} />
        {data.shifts.length > 0 ? (
          <ul className="divide-y divide-line/60">
            {data.shifts.map((s) => {
              const up = s.delta >= 0;
              const pct = s.prev > 0 ? (s.delta / s.prev) * 100 : null;
              return (
                <li key={s.category} className="flex items-center gap-3 py-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-[var(--brass)]">
                    <CategoryIcon icon={s.icon} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.category}</p>
                    <p className="mono text-xs text-[var(--muted)]">
                      {money(s.prev)} → {money(s.current)}
                    </p>
                  </div>
                  <span
                    className={`mono inline-flex shrink-0 items-center gap-1 text-sm ${
                      up ? "text-[var(--coral)]" : "text-[var(--jade)]"
                    }`}
                  >
                    {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {up ? "+" : "−"}
                    {money(Math.abs(s.delta))}
                    {pct != null && (
                      <span className="text-[var(--muted)]">({Math.abs(pct).toFixed(0)}%)</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Blank>No category changes to compare against {data.prevLabel}.</Blank>
        )}
      </section>

      {/* Month-by-month + category mix. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="break-avoid space-y-4 lg:col-span-3">
          <SectionHead title={`Month by month · ${data.year}`} />
          <MonthlySpendChart data={data.monthlySpend} />
        </section>
        <section className="break-avoid space-y-4 lg:col-span-2">
          <SectionHead title="Where it went" />
          <CategoryChart data={data.categories} />
        </section>
      </div>

      <p className="print-only pt-4 text-center text-xs text-[var(--muted)]">
        budgetr — your data stays on your machine.
      </p>
    </div>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-[var(--muted)]">{children}</p>;
}

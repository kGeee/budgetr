import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import { MonthlySpendChart, NetWorthChart } from "@/components/charts";
import { SpendHeatmap } from "@/components/budget/spend-heatmap";
import { ReportPrintButton } from "@/components/report-print-button";
import { ReportScheduleForm } from "@/components/report-schedule-form";
import { getReportSchedule } from "@/lib/actions-reports";
import {
  buildReportData,
  formatReportMoney,
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  type ReportPeriod,
} from "@/lib/report";
import { spendingVerdict } from "@/lib/spending-verdict";
import { spendingHref } from "./href";
import { CategoryDot, RuledRow, ShareBar, ShiftsTable, segment, segmentGroup } from "./ruled";

/**
 * Spending → report mode (?report=1): the printable period report, meant to be
 * saved as a PDF or emailed. The `report-page` container is the print root —
 * the `@media print` rules in globals.css hide the app chrome (`.no-print`) and
 * reset page padding so only this content lands on paper.
 */
export async function ReportView({
  period,
  rawCurrency,
}: {
  period: ReportPeriod;
  /** ?currency= override; the persisted display currency when absent. */
  rawCurrency?: string;
}) {
  const data = buildReportData(period, rawCurrency);
  const schedule = await getReportSchedule();
  const cur = data.currency;
  const money = (v: number) => formatReportMoney(v, cur);

  const q = (p: string) =>
    spendingHref({ report: true, period: p, currency: rawCurrency ? cur : undefined });
  const topVendor = data.topVendors[0];
  const verdict = spendingVerdict(data.totals);
  const categoryTotal = data.categories.reduce((sum, c) => sum + c.total, 0);
  const colorOf = new Map(data.categoryMeta.map((c) => [c.id, c.color]));

  return (
    // The report on the left, the schedule that mails it on the right. The
    // article is the print root; the aside and every control are `.no-print`.
    <div className="report-page flex flex-wrap items-start gap-x-12 gap-y-9 py-2">
      <article aria-label="Printable report" className="flex min-w-0 flex-[3_1_560px] flex-col gap-9">
        {/* Print-only masthead. */}
        <div className="print-only">
          <p className="eyebrow text-[var(--brass)]">budgetr · {REPORT_PERIOD_LABELS[period]}</p>
          <h1 className="mt-1 font-display text-4xl tracking-tight">{data.label} in review</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Generated {format(parseISO(data.generatedAt), "PPpp")} · figures in {cur}
          </p>
        </div>

        {/* Hero — the period's one figure, the sentence that reads it, then the
            figures it is made of on a single rule. */}
        <section aria-label="Summary" className="break-avoid flex flex-col gap-5">
          <div className="no-print flex flex-wrap items-center justify-between gap-2.5">
            <Link
              href={spendingHref({ period })}
              className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
            >
              <ArrowLeft size={16} aria-hidden /> Spending
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Period" className={segmentGroup}>
                {REPORT_PERIODS.map((p) => (
                  <Link
                    key={p}
                    href={q(p)}
                    aria-current={p === period ? "page" : undefined}
                    className={segment(p === period)}
                  >
                    {REPORT_PERIOD_LABELS[p]}
                  </Link>
                ))}
              </div>
              <ReportPrintButton />
            </div>
          </div>
          {data.empty ? (
            <>
              <p className="eyebrow">Printable report · {data.label} in review</p>
              <p className="text-[var(--muted)]">Nothing recorded for {data.label} yet.</p>
            </>
          ) : (
            <>
              <Hero
                eyebrow={`Printable report · ${data.label} in review`}
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
        <section aria-label="Net worth" className="break-avoid space-y-3">
          <SectionHead title="Net worth" />
          <NetWorthChart data={data.netWorth} />
        </section>

        {/* Daily-spend calendar — trailing year. */}
        <section aria-label="Daily spend, trailing year" className="break-avoid space-y-3.5">
          <SectionHead title="Daily spend · trailing year" />
          <SpendHeatmap
            data={data.heatmap}
            start={data.heatmapStart}
            end={data.heatmapEnd}
            categories={data.categoryMeta}
          />
        </section>

        {/* Top vendors + biggest purchases. */}
        <div className="flex flex-wrap gap-x-10 gap-y-9">
          <section aria-label="Top vendors" className="break-avoid min-w-0 flex-[1_1_260px]">
            <SectionHead title="Top vendors" />
            {data.topVendors.length > 0 ? (
              <ul>
                {data.topVendors.map((v) => (
                  <RuledRow key={v.vendor} figure={money(v.total)}>
                    <span className="font-medium">{v.vendor}</span>
                    <span className="ml-2.5 text-xs text-[var(--muted)]">
                      {v.count} charge{v.count === 1 ? "" : "s"}
                    </span>
                  </RuledRow>
                ))}
              </ul>
            ) : (
              <Blank>No vendor spend in this period.</Blank>
            )}
          </section>

          <section aria-label="Biggest purchases" className="break-avoid min-w-0 flex-[1_1_260px]">
            <SectionHead title="Biggest purchases" />
            {data.biggest.length > 0 ? (
              <ul>
                {data.biggest.map((b) => (
                  <RuledRow key={b.id} figure={money(b.amount)}>
                    <span className="mono mr-3 text-xs text-[var(--muted)]">
                      {format(parseISO(b.date), "MMM d")}
                    </span>
                    {b.vendor}
                    <span className="ml-2.5 text-xs text-[var(--muted)]">{b.categoryName}</span>
                  </RuledRow>
                ))}
              </ul>
            ) : (
              <Blank>No purchases in this period.</Blank>
            )}
          </section>
        </div>

        {/* Category shifts vs prior period. */}
        <div className="break-avoid">
          <ShiftsTable
            shifts={data.shifts}
            prevLabel={data.prevLabel}
            label={data.label}
            fmt={money}
          />
        </div>

        {/* Month-by-month + category mix. */}
        <div className="flex flex-wrap gap-x-10 gap-y-9">
          <section
            aria-label={`Month by month, ${data.year}`}
            className="break-avoid min-w-0 flex-[1_1_260px] space-y-3"
          >
            <SectionHead title={`Month by month · ${data.year}`} />
            <MonthlySpendChart data={data.monthlySpend} />
          </section>
          <section aria-label="Where it went" className="break-avoid min-w-0 flex-[1_1_260px]">
            <SectionHead title="Where it went" />
            {data.categories.length > 0 ? (
              <ul className="pt-1.5">
                {data.categories.map((c) => {
                  const key = c.categoryId ?? c.category;
                  const color = c.categoryId ? colorOf.get(c.categoryId) : null;
                  return (
                    <li
                      key={key}
                      className="grid min-h-[34px] grid-cols-[minmax(0,1fr)_70px_92px] items-center gap-3 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <CategoryDot id={key} color={color} />
                        <span className="truncate">{c.category}</span>
                      </span>
                      <ShareBar
                        pct={categoryTotal > 0 ? (c.total / categoryTotal) * 100 : 0}
                        id={key}
                        color={color}
                      />
                      <span className="mono text-right text-[13px] tabular">{money(c.total)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Blank>No spending in this period.</Blank>
            )}
          </section>
        </div>

        <p className="print-only pt-4 text-center text-xs text-[var(--muted)]">
          budgetr — your data stays on your machine.
        </p>
      </article>

      <aside
        aria-label="Scheduled report"
        className="no-print min-w-0 flex-[1_1_280px] lg:max-w-[360px]"
      >
        <SectionHead title="Send it on a schedule" />
        <ReportScheduleForm initial={schedule} />
        <p className="text-xs text-[var(--muted)]">
          &ldquo;Send now&rdquo; renders this month&rsquo;s report; delivery stays a stub until a
          mail provider is wired up. Printing strips the sidebar and this panel.
        </p>
      </aside>
    </div>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-[var(--muted)]">{children}</p>;
}

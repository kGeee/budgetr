import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  LineChart as LineChartIcon,
  Receipt,
  Sparkles,
  Trophy,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryChart, MonthlySpendChart, NetWorthChart } from "@/components/charts";
import { CategoryIcon } from "@/components/category-pill";
import { SpendHeatmap } from "@/components/spend-heatmap";
import { ReportPrintButton } from "@/components/report-print-button";
import {
  buildReportData,
  formatReportMoney,
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  reportPeriodFromParam,
} from "@/lib/report";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; currency?: string }>;
}) {
  const { period: rawPeriod, currency: rawCurrency } = await searchParams;
  const period = reportPeriodFromParam(rawPeriod);
  const data = buildReportData(period, rawCurrency);
  const cur = data.currency;
  const money = (v: number) => formatReportMoney(v, cur);

  const q = (p: string) => `/report?period=${p}${rawCurrency ? `&currency=${cur}` : ""}`;
  const topVendor = data.topVendors[0];

  return (
    <div className="space-y-7 py-2">
      {/* Header — hidden from print via .no-print, replaced by the printed title below. */}
      <div className="no-print flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
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

      {/* Hero — headline totals. */}
      <Card className="break-avoid overflow-hidden">
        <div className="flex items-center gap-2 text-[var(--brass)]">
          <Sparkles size={16} />
          <p className="eyebrow">{data.label} summary</p>
        </div>
        {data.empty ? (
          <p className="mt-4 text-[var(--muted)]">Nothing recorded for {data.label} yet.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm text-[var(--muted)]">Total spent</p>
                <p className="mt-1.5 font-display text-5xl leading-none tracking-tight tabular sm:text-6xl">
                  {money(data.totals.expenses)}
                </p>
                <p className="mt-3 text-sm text-[var(--muted)]">
                  across {data.totals.txCount.toLocaleString()} transaction
                  {data.totals.txCount === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex gap-8">
                <Stat label="Income" value={money(data.totals.income)} tone="jade" />
                <span className="w-px self-stretch bg-line" />
                <Stat
                  label="Net"
                  value={`${data.totals.net >= 0 ? "+" : "−"}${money(Math.abs(data.totals.net))}`}
                  tone={data.totals.net >= 0 ? "jade" : "coral"}
                />
                <span className="w-px self-stretch bg-line" />
                <Stat label="Net worth" value={money(data.netWorthCurrent)} tone="paper" />
              </div>
            </div>
            {topVendor && (
              <p className="mt-6 border-t border-line pt-5 text-sm text-[var(--muted)]">
                Top vendor was{" "}
                <span className="font-medium text-[var(--paper)]">{topVendor.vendor}</span> at{" "}
                <span className="mono text-[var(--paper)]">{money(topVendor.total)}</span> over{" "}
                {topVendor.count} visit{topVendor.count === 1 ? "" : "s"}.
              </p>
            )}
          </>
        )}
      </Card>

      {/* Net worth over time. */}
      <Card className="break-avoid">
        <CardHeader>
          <CardTitle>Net worth</CardTitle>
          <LineChartIcon size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <NetWorthChart data={data.netWorth} />
      </Card>

      {/* Daily-spend calendar — trailing year. */}
      <Card className="break-avoid">
        <CardHeader>
          <CardTitle>Daily spend · trailing year</CardTitle>
          <CalendarDays size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <SpendHeatmap
          data={data.heatmap}
          start={data.heatmapStart}
          end={data.heatmapEnd}
          categories={data.categoryMeta}
        />
      </Card>

      {/* Top vendors + biggest purchases. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="break-avoid">
          <CardHeader>
            <CardTitle>Top vendors</CardTitle>
            <Trophy size={15} className="text-[var(--brass)]" />
          </CardHeader>
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
        </Card>

        <Card className="break-avoid">
          <CardHeader>
            <CardTitle>Biggest purchases</CardTitle>
            <Receipt size={15} className="text-[var(--brass)]" />
          </CardHeader>
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
        </Card>
      </div>

      {/* Category shifts vs prior period. */}
      <Card className="break-avoid">
        <CardHeader>
          <CardTitle>Category shifts · vs {data.prevLabel}</CardTitle>
        </CardHeader>
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
      </Card>

      {/* Month-by-month + category mix. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="break-avoid lg:col-span-3">
          <CardHeader>
            <CardTitle>Month by month · {data.year}</CardTitle>
          </CardHeader>
          <MonthlySpendChart data={data.monthlySpend} />
        </Card>
        <Card className="break-avoid lg:col-span-2">
          <CardHeader>
            <CardTitle>Where it went</CardTitle>
          </CardHeader>
          <CategoryChart data={data.categories} />
        </Card>
      </div>

      <p className="print-only pt-4 text-center text-xs text-[var(--muted)]">
        budgetr — your data stays on your machine.
      </p>
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
  tone: "jade" | "coral" | "paper";
}) {
  const cls =
    tone === "jade" ? "text-[var(--jade)]" : tone === "coral" ? "text-[var(--coral)]" : "";
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1.5 font-display text-2xl tabular ${cls}`}>{value}</p>
    </div>
  );
}

function Blank({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-[var(--muted)]">{children}</p>;
}

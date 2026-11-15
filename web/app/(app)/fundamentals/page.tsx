import Link from "next/link";
import { Search } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { InvestmentsTabs } from "@/components/investments-tabs";
import { requireTradingDesk } from "@/lib/trading-desk";
import { Card } from "@/components/ui/card";
import { Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import { marginVerdict } from "@/lib/investments-verdict";
import { IncomeSankey } from "@/components/fundamentals/income-sankey";
import { getIncomeStatement } from "@/lib/sec";
import { toSankey } from "@/lib/fundamentals/income-statement";

export const dynamic = "force-dynamic";
// Holdings-agnostic: SEC fetches should hit the Data Cache, not be forced no-store.
export const fetchCache = "default-cache";

export const metadata = { title: "Fundamentals — budgetr" };

function pct(part: number, whole: number): string {
  return whole ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}

export default async function FundamentalsPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string; period?: string }>;
}) {
  // Part of the Trading desk: with it off, land on the Settings switch instead.
  requireTradingDesk();
  const { ticker, period: periodParam } = await searchParams;
  const sym = (ticker ?? "").trim().toUpperCase();
  const period = periodParam === "quarterly" ? "quarterly" : "annual";
  const is = sym ? await getIncomeStatement(sym, period) : null;
  const sankey = is ? toSankey(is) : null;
  const verdict = is ? marginVerdict({ revenue: is.revenue, netIncome: is.netIncome }) : null;
  const periodLabel = is
    ? is.period === "quarterly"
      ? `${is.fiscalPeriod ?? "Q"} FY${is.fiscalYear ?? "—"}`
      : `FY${is.fiscalYear ?? "—"}`
    : "";

  return (
    <div className="space-y-6">
      {/* Lives outside investments/layout.tsx, so it renders the section bar itself. */}
      <InvestmentsTabs tradingDesk />
      <PageHead
        title="Fundamentals"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {sym && (
              <div className="flex rounded-full border border-line bg-[var(--panel)] p-0.5 text-sm">
                {(["annual", "quarterly"] as const).map((p) => (
                  <Link
                    key={p}
                    href={{ pathname: "/fundamentals", query: { ticker: sym, period: p } }}
                    className={`rounded-full px-3 py-1 capitalize transition ${
                      period === p ? "bg-[var(--panel-2)] text-[var(--paper)]" : "text-[var(--muted)]"
                    }`}
                  >
                    {p}
                  </Link>
                ))}
              </div>
            )}
            <form action="/fundamentals" method="get" className="flex items-center gap-2">
              <input type="hidden" name="period" value={period} />
              <div className="flex items-center gap-2 rounded-full border border-line bg-[var(--panel)] px-3.5 py-1.5">
                <Search size={14} className="text-[var(--muted)]" />
                <input
                  name="ticker"
                  defaultValue={sym}
                  placeholder="Ticker (e.g. AAPL)"
                  autoCapitalize="characters"
                  className="w-32 bg-transparent text-sm outline-none placeholder:text-[var(--faint)]"
                />
              </div>
            </form>
          </div>
        }
      />

      {!sym && (
        <Card className="p-10 text-center">
          <p className="text-sm text-[var(--muted)]">
            Enter a ticker to see its latest annual income statement as an interactive flow.
          </p>
          <p className="mt-1 text-xs text-[var(--faint)]">Sourced from SEC filings — US-listed companies.</p>
        </Card>
      )}

      {sym && !is && (
        <Card className="p-10 text-center">
          <p className="text-sm text-[var(--muted)]">
            No SEC financials found for <b className="text-[var(--paper)]">{sym}</b>.
          </p>
          <p className="mt-1 text-xs text-[var(--faint)]">
            It may be an ETF, ADR, or non-US filer without XBRL income-statement data.
          </p>
        </Card>
      )}

      {is && sankey && (
        <>
          {/* The statement boils down to one ratio — what was left of each
              dollar sold — so that is the figure; the two margins above it on
              the income statement sit on the rule beneath. */}
          <section className="space-y-5">
            <Hero
              eyebrow={`Net margin · ${is.entityName ?? sym} · ${sym} · ${periodLabel}`}
              figure={pct(is.netIncome, is.revenue)}
              tone={verdict?.tone === "coral" ? "coral" : "default"}
              verdict={
                verdict && (
                  <>
                    {sym} {verdict.lead} <Mark tone={verdict.tone}>{verdict.margin}</Mark>{" "}
                    {verdict.tail}
                  </>
                )
              }
            />
            <StatStrip>
              <Stat label="Gross margin" value={pct(is.grossProfit, is.revenue)} />
              <Stat label="Operating margin" value={pct(is.operatingIncome, is.revenue)} />
              <Stat label="Net margin" value={pct(is.netIncome, is.revenue)} />
              <Stat
                label={is.period === "quarterly" ? "Quarter ended" : "Fiscal year ended"}
                value={is.periodEnd}
              />
            </StatStrip>
          </section>

          <section className="space-y-4">
            <SectionHead title="Income statement · annual" />
            <IncomeSankey data={sankey} />
          </section>
        </>
      )}
    </div>
  );
}

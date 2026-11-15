import Link from "next/link";
import { Search } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { requireTradingDesk } from "@/lib/trading-desk";
import { Hero, Mark, SectionHead } from "@/components/ui/statement";
import { marginVerdict } from "@/lib/investments-verdict";
import { IncomeBars } from "@/components/fundamentals/income-bars";
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
    <div className="space-y-9">
      {/* Lives outside investments/layout.tsx, so it renders the section bar itself. */}
      <PageHead title="Fundamentals" />

      {/* The statement boils down to one ratio — what was left of each dollar
          sold — so that is the figure the page opens on. */}
      {is && (
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
      )}

      <section
        aria-label={sym ? `${sym} fundamentals` : "Fundamentals"}
        className="flex flex-col gap-1"
      >
        {/* The period switch and the ticker lookup sit on the section's own
            rule, beside the statement they change. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-strong)] pb-2.5">
          <h2 className="font-display text-lg tracking-tight">
            Fundamentals{sym && ` · ${sym}`}
            {is && (
              <span className="ml-2 font-sans text-xs font-normal tracking-normal text-[var(--muted)]">
                Income statement · {is.period} · {periodLabel}
              </span>
            )}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {sym && (
              <div
                role="group"
                aria-label="Period"
                className="inline-flex rounded-full border border-line p-[3px] text-[13px]"
              >
                {(["annual", "quarterly"] as const).map((p) => (
                  <Link
                    key={p}
                    href={{ pathname: "/fundamentals", query: { ticker: sym, period: p } }}
                    aria-current={period === p ? "true" : undefined}
                    className={`flex min-h-8 items-center rounded-full px-3 transition-colors ${
                      period === p
                        ? "bg-[var(--panel-2)] text-[var(--paper)]"
                        : "text-[var(--muted)] hover:text-[var(--paper)]"
                    }`}
                  >
                    {p === "annual" ? "Fiscal year" : "Quarter"}
                  </Link>
                ))}
              </div>
            )}
            <form action="/fundamentals" method="get">
              <input type="hidden" name="period" value={period} />
              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                Look up
                <span className="flex min-h-10 items-center gap-2 rounded-xl border border-line bg-[var(--panel)] px-3.5 focus-within:border-[var(--brass-dim)]">
                  <Search size={14} className="text-[var(--muted)]" />
                  <input
                    name="ticker"
                    defaultValue={sym}
                    placeholder="Ticker (e.g. AAPL)"
                    autoCapitalize="characters"
                    className="w-32 bg-transparent text-sm text-[var(--paper)] outline-none placeholder:text-[var(--muted)]"
                  />
                </span>
              </label>
            </form>
          </div>
        </div>

        {!sym && (
          <div className="border-b border-line py-10">
            <p className="text-sm text-[var(--muted)]">
              Enter a ticker to see its latest annual income statement, layer by layer.
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Sourced from SEC filings — US-listed companies.
            </p>
          </div>
        )}

        {sym && !is && (
          <div className="border-b border-line py-10">
            <p className="text-sm text-[var(--muted)]">
              No SEC financials found for <b className="text-[var(--paper)]">{sym}</b>.
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              It may be an ETF, ADR, or non-US filer without XBRL income-statement data.
            </p>
          </div>
        )}

        {is && (
          <div className="flex flex-wrap gap-x-12 gap-y-6 pt-4">
            <div className="min-w-0 flex-[3_1_460px]">
              <IncomeBars is={is} />
            </div>
            <div className="flex min-w-0 flex-[1_1_220px] flex-col">
              <dl>
                {[
                  ["Gross margin", pct(is.grossProfit, is.revenue)],
                  ["Operating margin", pct(is.operatingIncome, is.revenue)],
                  ["Net margin", pct(is.netIncome, is.revenue)],
                  [is.period === "quarterly" ? "Quarter ended" : "Fiscal year ended", is.periodEnd],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex min-h-11 items-center justify-between gap-3 border-b border-line"
                  >
                    <dt className="text-[var(--muted)]">{label}</dt>
                    <dd className="mono tabular">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-[var(--muted)]">
                Sourced from SEC filings — US-listed companies.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* The same statement as a flow, with the operating-expense breakdown
          (R&D, SG&A, …) the four bars above fold into one figure. */}
      {is && sankey && (
        <section className="space-y-4">
          <SectionHead
            title="Where each dollar went"
            action={
              <span className="text-xs text-[var(--muted)]">
                hover a node or flow for the exact figure
              </span>
            }
          />
          <IncomeSankey data={sankey} />
        </section>
      )}
    </div>
  );
}

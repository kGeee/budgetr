import { Search } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { Card } from "@/components/ui/card";
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
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker } = await searchParams;
  const sym = (ticker ?? "").trim().toUpperCase();
  const is = sym ? await getIncomeStatement(sym) : null;
  const sankey = is ? toSankey(is) : null;

  return (
    <div className="space-y-6">
      <PageHead
        title="Fundamentals"
        action={
          <form action="/fundamentals" method="get" className="flex items-center gap-2">
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
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-5">
            <div>
              <p className="eyebrow">{is.entityName ?? sym}</p>
              <p className="mt-1 font-display text-2xl">
                {sym} · FY{is.fiscalYear ?? "—"}
              </p>
            </div>
            <p className="text-xs text-[var(--muted)]">Fiscal year ended {is.periodEnd}</p>
          </div>

          <Card className="p-0">
            <div className="border-b border-line px-5 py-3.5">
              <span className="eyebrow">Income statement · annual</span>
            </div>
            <div className="p-4">
              <IncomeSankey data={sankey} />
            </div>
          </Card>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Gross margin" value={pct(is.grossProfit, is.revenue)} />
            <Stat label="Operating margin" value={pct(is.operatingIncome, is.revenue)} />
            <Stat label="Net margin" value={pct(is.netIncome, is.revenue)} />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 font-display text-2xl tabular">{value}</p>
    </div>
  );
}

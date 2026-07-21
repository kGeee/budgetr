import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { FixedStrikeVolView } from "@/components/fixed-strike-vol-view";
import { getCboeOptionChain } from "@/lib/cboe";
import { getOptionChain } from "@/lib/yahoo";
import { getQuotes } from "@/lib/finnhub";
import { captureIvSnapshots, loadIvSnapshots } from "@/lib/fixed-strike-vol";

export const dynamic = "force-dynamic";
// Chain fetches ride the 30m Data Cache; snapshots persist once per day.
export const fetchCache = "default-cache";

export default async function FixedStrikeVolPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw).trim().toUpperCase();

  // Refresh today's surface capture on every visit (idempotent per day),
  // then read the accumulated history back.
  const chain = (await getCboeOptionChain(ticker, [])) ?? (await getOptionChain(ticker, []));
  const snapshot = await getQuotes([ticker]);
  const spot = snapshot[ticker]?.price ?? null;
  if (chain) captureIvSnapshots(ticker, chain, spot);
  const rows = loadIvSnapshots(ticker);

  return (
    <div className="space-y-7">
      <PageHead
        title={`${ticker} fixed-strike vol`}
        action={
          <Link
            href={`/investments/options/${encodeURIComponent(ticker)}`}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
          >
            <ArrowLeft size={15} />
            Options desk
          </Link>
        }
      />
      <FixedStrikeVolView ticker={ticker} rows={rows} />
    </div>
  );
}

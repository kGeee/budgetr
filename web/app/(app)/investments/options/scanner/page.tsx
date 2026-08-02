import { PageHead } from "@/components/page-head";
import { OptionsToolTabs } from "@/components/investments-tabs";
import { ScannerView } from "@/components/scanner-view";
import { scanWheelPuts } from "@/lib/wheel-scanner-data";

// DB (holdings/universe) stays fresh; the CBOE/Yahoo chain fetches ride the
// 30m Data Cache, so a scan is cheap to re-open within the window.
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

/**
 * Options › Scanner — ranked cash-secured puts across a liquid universe. It
 * ranges over every symbol scanned, not the one you came from; before it had a
 * tab here it was reachable only through a link on the Wheel page, four clicks
 * deep and only if you already held an option leg.
 */
export default async function ScannerPage() {
  const result = await scanWheelPuts();
  return (
    <div className="space-y-7">
      <OptionsToolTabs />
      <PageHead
        title="Wheel scanner"
        action={
          <span className="rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)]">
            whole universe
          </span>
        }
      />
      <ScannerView result={result} />
    </div>
  );
}

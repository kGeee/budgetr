import { PageHead } from "@/components/page-head";
import { OptionsToolTabs, SubTabs } from "@/components/investments-tabs";
import { WheelView } from "@/components/options/wheel-view";
import { ScannerView } from "@/components/options/scanner-view";
import { buildWheelReport } from "@/lib/wheel";
import { scanWheelPuts } from "@/lib/wheel-scanner-data";

export const dynamic = "force-dynamic";
// DB (holdings/universe) stays fresh; the scanner's CBOE/Yahoo chain fetches
// ride the 30m Data Cache, so a scan is cheap to re-open within the window.
export const fetchCache = "default-cache";

/**
 * Options › Wheel — two halves of the same strategy (`?tab=`). The default is
 * your own put → assignment → call cycles across the whole book; `?tab=scan` is
 * the scanner, ranked cash-secured puts across a liquid universe — where the
 * next cycle starts. The scanner used to be its own tool; it only ever served
 * the wheel, so it lives here now, and only runs when its tab is open.
 */
export default async function WheelPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const scan = (await searchParams).tab === "scan";

  return (
    <div className="space-y-7">
      <OptionsToolTabs />
      <PageHead
        title={scan ? "Wheel scanner" : "Wheel & premium"}
        action={
          <span className="rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)]">
            {scan ? "whole universe" : "whole portfolio"}
          </span>
        }
      />
      <SubTabs
        label="Wheel views"
        active={scan ? "scan" : "wheel"}
        tabs={[
          { key: "wheel", label: "Your wheel", href: "/investments/options/wheel" },
          { key: "scan", label: "Scanner", href: "/investments/options/wheel?tab=scan" },
        ]}
      />
      {scan ? (
        <ScannerView result={await scanWheelPuts()} />
      ) : (
        <WheelView report={buildWheelReport()} />
      )}
    </div>
  );
}

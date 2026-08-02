import { PageHead } from "@/components/page-head";
import { OptionsToolTabs } from "@/components/investments-tabs";
import { WheelView } from "@/components/wheel-view";
import { buildWheelReport } from "@/lib/wheel";

export const dynamic = "force-dynamic";

/**
 * Options › Wheel — put → assignment → call cycles across the whole book. Not
 * scoped to a symbol, which is why it no longer sits under a `[ticker]` route.
 * The hand-written "Scanner" and "← Investments" links are gone: the tool bar
 * and the section bar cover both.
 */
export default async function WheelPage() {
  const report = buildWheelReport();
  return (
    <div className="space-y-7">
      <OptionsToolTabs />
      <PageHead
        title="Wheel & premium"
        action={
          <span className="rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)]">
            whole portfolio
          </span>
        }
      />
      <WheelView report={report} />
    </div>
  );
}

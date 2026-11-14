import Link from "next/link";
import { FileText, Settings2 } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { REPORT_PERIODS, REPORT_PERIOD_LABELS, type ReportPeriod } from "@/lib/report";
import { SPENDING_VIEWS, spendingHref, type SpendingView } from "./href";

const pill = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm transition-colors ${
    active
      ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
      : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
  }`;

/**
 * Page head + the two selectors every Spending view shares: the period (one
 * picker for the whole page) and the view. The vendor directory is all-time, so
 * it swaps the period tabs for a plain label rather than offering a control
 * that wouldn't change anything.
 */
export function SpendingNav({
  view,
  period,
  explicitPeriod,
}: {
  view: SpendingView;
  period: ReportPeriod;
  /** The period the user chose, if any — carried across view switches. */
  explicitPeriod?: ReportPeriod;
}) {
  return (
    <div className="space-y-4">
      <PageHead
        title="Spending"
        action={
          view === "vendor" ? (
            <span className="text-sm text-[var(--muted)]">All time</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {REPORT_PERIODS.map((p) => (
                <Link
                  key={p}
                  href={spendingHref({ view, period: p })}
                  aria-current={p === period ? "page" : undefined}
                  className={pill(p === period)}
                >
                  {REPORT_PERIOD_LABELS[p]}
                </Link>
              ))}
            </div>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1.5" aria-label="Spending views">
          {SPENDING_VIEWS.map((v) => (
            <Link
              key={v.key}
              href={spendingHref({ view: v.key, period: explicitPeriod })}
              aria-current={v.key === view ? "page" : undefined}
              className={pill(v.key === view)}
            >
              {v.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-4 text-sm">
          {view === "category" && (
            <Link
              href="/settings#categories"
              className="inline-flex items-center gap-1.5 text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
            >
              <Settings2 size={14} /> Manage categories
            </Link>
          )}
          <Link
            href={spendingHref({ report: true, period: explicitPeriod })}
            className="inline-flex items-center gap-1.5 text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
          >
            <FileText size={14} /> Report
          </Link>
        </div>
      </div>
    </div>
  );
}

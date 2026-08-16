import { CalendarClock } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { RecurringView } from "@/components/recurring-view";
import { getRecurringStreams } from "@/lib/queries";
import { todayIso } from "@/lib/data-freshness";

export const dynamic = "force-dynamic";

export default function RecurringPage() {
  const streams = getRecurringStreams();
  const income = streams.filter((s) => s.direction === "inflow");
  const bills = streams.filter((s) => s.direction === "outflow");

  return (
    <div className="space-y-7">
      <PageHead title="Recurring" />

      {streams.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-10 text-center">
          <CalendarClock size={28} className="mx-auto text-[var(--faint)]" />
          <p className="mt-3 text-sm text-[var(--muted)]">
            No recurring streams yet. Hit Sync — Plaid needs some transaction history to detect
            them.
          </p>
        </div>
      ) : (
        <RecurringView bills={bills} income={income} today={todayIso()} />
      )}
    </div>
  );
}

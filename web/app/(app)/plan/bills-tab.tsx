import { CalendarClock } from "lucide-react";
import { RecurringView } from "@/components/transactions/recurring-view";
import { getRecurringStreams } from "@/lib/queries";
import { todayIso } from "@/lib/data-freshness";

/** "Bills & income" tab of /plan — what used to be /recurring. */
export function BillsTab() {
  const streams = getRecurringStreams();
  const income = streams.filter((s) => s.direction === "inflow");
  const bills = streams.filter((s) => s.direction === "outflow");

  if (streams.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-line p-10 text-center">
        <CalendarClock size={28} className="mx-auto text-[var(--muted)]" />
        <p className="mt-3 text-sm text-[var(--muted)]">
          No recurring streams yet. Hit Sync — Plaid needs some transaction history to detect them.
        </p>
      </div>
    );
  }
  return <RecurringView bills={bills} income={income} today={todayIso()} />;
}

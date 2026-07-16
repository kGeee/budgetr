import { format, parseISO } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, CalendarClock } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { getRecurringStreams, type RecurringRow } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FREQUENCY_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  ANNUALLY: "Yearly",
  UNKNOWN: "Irregular",
};

function prettyFrequency(f: string | null): string {
  return (f && FREQUENCY_LABEL[f]) ?? "Recurring";
}

export default function RecurringPage() {
  const streams = getRecurringStreams();
  const income = streams.filter((s) => s.direction === "inflow");
  const bills = streams.filter((s) => s.direction === "outflow");

  return (
    <div className="space-y-7">
      <PageHead title="Recurring" />
      <p className="-mt-3 max-w-xl text-sm text-[var(--muted)]">
        Subscriptions, bills, and income that repeat — detected automatically from your transaction
        history.
      </p>

      {streams.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-10 text-center">
          <CalendarClock size={28} className="mx-auto text-[var(--faint)]" />
          <p className="mt-3 text-sm text-[var(--muted)]">
            No recurring streams yet. Hit Sync — Plaid needs some transaction history to detect them.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <Section title="Bills & subscriptions" rows={bills} />
          <Section title="Income" rows={income} />
        </div>
      )}
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: RecurringRow[] }) {
  if (rows.length === 0) return null;
  const monthlyTotal = rows.reduce((s, r) => s + Math.abs(r.averageAmount ?? 0), 0);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <p className="eyebrow">{title}</p>
        <span className="mono text-xs text-[var(--muted)]">
          ~{formatCurrency(monthlyTotal)} / period
        </span>
      </div>
      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
        <ul>
          {rows.map((r) => (
            <Row key={r.id} row={r} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function Row({ row }: { row: RecurringRow }) {
  const income = row.direction === "inflow";
  const amount = Math.abs(row.averageAmount ?? 0);

  return (
    <li className="flex items-center gap-4 border-b border-line/60 px-6 py-4 last:border-0 transition-colors hover:bg-[var(--panel-2)]">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${
          income
            ? "border-[color-mix(in_srgb,var(--jade)_35%,transparent)] text-[var(--jade)]"
            : "border-line text-[var(--muted)]"
        }`}
      >
        {income ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {row.merchantName ?? row.description ?? "Unknown"}
        </p>
        <p className="truncate text-xs text-[var(--muted)]">
          {prettyFrequency(row.frequency)} · {row.accountName}
        </p>
      </div>

      <div className="hidden text-right sm:block">
        {row.predictedNextDate ? (
          <>
            <p className="eyebrow">Next</p>
            <p className="mono text-xs text-[var(--paper)]">
              {format(parseISO(row.predictedNextDate), "MMM d")}
            </p>
          </>
        ) : (
          row.lastDate && (
            <>
              <p className="eyebrow">Last</p>
              <p className="mono text-xs text-[var(--muted)]">
                {format(parseISO(row.lastDate), "MMM d")}
              </p>
            </>
          )
        )}
      </div>

      <span
        className={`mono w-24 shrink-0 text-right text-sm ${income ? "text-[var(--jade)]" : "text-[var(--paper)]"}`}
      >
        {formatCurrency(amount, row.currency ?? "USD")}
      </span>
    </li>
  );
}

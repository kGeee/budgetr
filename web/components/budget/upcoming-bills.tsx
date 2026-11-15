import Link from "next/link";
import { SectionHead } from "@/components/ui/statement";
import { shortDate } from "@/components/transactions/ledger-bits";
import { formatCurrency } from "@/lib/utils";
import type { RecurringRow } from "@/lib/queries";
import { streamLabel } from "@/lib/recurring";

/** Predicted charges, soonest first, as ruled rows: date, name, amount. */
export function UpcomingBills({ bills }: { bills: RecurringRow[] }) {
  const total = bills.reduce((s, b) => s + Math.abs(b.averageAmount ?? 0), 0);

  return (
    <section aria-label="Upcoming bills">
      <SectionHead
        id="upcoming"
        title="Upcoming"
        action={
          <Link
            href="/plan?tab=bills"
            className="text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
          >
            Bills &amp; income
          </Link>
        }
      />

      {bills.length === 0 ? (
        <p className="border-b border-line py-3.5 text-sm text-[var(--muted)]">
          No bills predicted in the next two weeks.
        </p>
      ) : (
        <>
          <ul>
            {bills.map((b) => (
              <li
                key={b.id}
                className="flex min-h-[46px] items-center justify-between gap-3 border-b border-line text-sm"
              >
                <span className="flex min-w-0 items-baseline gap-3">
                  <span className="mono w-12 shrink-0 text-xs text-[var(--muted)]">
                    {b.predictedNextDate ? shortDate(b.predictedNextDate) : "—"}
                  </span>
                  <span className="min-w-0 truncate">
                    {streamLabel(b).name}
                    {b.accountName && (
                      <span className="text-[13px] text-[var(--muted)]"> · {b.accountName}</span>
                    )}
                  </span>
                </span>
                <span className="mono shrink-0">
                  {formatCurrency(Math.abs(b.averageAmount ?? 0), b.currency ?? "USD")}
                </span>
              </li>
            ))}
          </ul>
          <p className="flex items-center justify-between gap-3 pt-2.5 text-xs text-[var(--muted)]">
            <span>Due soon</span>
            <span className="mono text-[13px] text-[var(--paper)]">{formatCurrency(total)}</span>
          </p>
        </>
      )}
    </section>
  );
}

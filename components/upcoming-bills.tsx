import { format, parseISO } from "date-fns";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { RecurringRow } from "@/lib/queries";

export function UpcomingBills({ bills }: { bills: RecurringRow[] }) {
  const total = bills.reduce((s, b) => s + Math.abs(b.averageAmount ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Next two weeks</CardTitle>
        <Link href="/recurring" className="text-xs text-[var(--brass)] hover:underline">
          Recurring →
        </Link>
      </CardHeader>

      {bills.length === 0 ? (
        <p className="py-2 text-sm text-[var(--muted)]">No bills predicted in the next 14 days.</p>
      ) : (
        <>
          <ul className="-mx-2">
            {bills.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-[var(--panel-2)]"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-center">
                  <span className="mono text-[10px] uppercase leading-none text-[var(--muted)]">
                    {b.predictedNextDate && format(parseISO(b.predictedNextDate), "MMM")}
                  </span>
                  <span className="font-display text-sm leading-none">
                    {b.predictedNextDate && format(parseISO(b.predictedNextDate), "d")}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {b.merchantName ?? b.description ?? "Bill"}
                  </p>
                  <p className="truncate text-xs text-[var(--muted)]">{b.accountName}</p>
                </div>
                <span className="mono shrink-0 text-sm">
                  {formatCurrency(Math.abs(b.averageAmount ?? 0), b.currency ?? "USD")}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="eyebrow">Due soon</span>
            <span className="mono text-sm text-[var(--paper)]">{formatCurrency(total)}</span>
          </div>
        </>
      )}
    </Card>
  );
}

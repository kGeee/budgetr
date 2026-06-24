import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { CategoryIcon } from "@/components/category-pill";
import { TransactionsTable } from "@/components/transactions-table";
import { Card } from "@/components/ui/card";
import {
  getCategories,
  getCategoryById,
  getCategoryMonthlyBreakdown,
  getCategoryTransactions,
} from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const category = getCategoryById(id);
  if (!category) notFound();

  const txns = getCategoryTransactions(id);
  const months = getCategoryMonthlyBreakdown(id);
  const categories = getCategories();

  // Income/transfer categories are dominated by inflow; spending by outflow.
  const inflowLed = category.group !== "spending" && category.received > category.spent;
  const headlineLabel = inflowLed ? "Received" : "Spent";
  const headlineValue = inflowLed ? category.received : category.spent;
  const maxMonth = Math.max(1, ...months.map((m) => Math.max(m.spent, m.received)));

  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <Link
          href="/categories"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
        >
          <ArrowLeft size={14} /> Categories
        </Link>
        <PageHead
          title={category.name}
          action={
            <div className="flex items-center gap-2.5">
              {category.archived && (
                <span className="rounded-md border border-line px-2 py-1 text-xs text-[var(--faint)]">
                  Archived
                </span>
              )}
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--brass)]">
                <CategoryIcon icon={category.icon} size={18} />
              </span>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label={headlineLabel} value={headlineValue} big />
        <Stat label="Transactions" raw={category.count.toLocaleString()} />
        <Stat
          label="Avg / month"
          value={months.length > 0 ? headlineValue / months.length : 0}
        />
      </div>

      {months.length > 0 && (
        <Card className="p-0">
          <div className="border-b border-line px-6 py-4">
            <span className="eyebrow">Monthly breakdown</span>
          </div>
          <ul>
            {months.map((m) => {
              const amount = inflowLed ? m.received : m.spent;
              const pct = Math.round((amount / maxMonth) * 100);
              return (
                <li
                  key={m.month}
                  className="flex items-center gap-4 border-b border-line/60 px-6 py-3 last:border-0"
                >
                  <span className="mono w-16 shrink-0 text-sm text-[var(--muted)]">{m.month}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--brass)]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs text-[var(--faint)]">
                    {m.count} {m.count === 1 ? "txn" : "txns"}
                  </span>
                  <span className="mono w-24 shrink-0 text-right text-sm">
                    {formatCurrency(amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="space-y-3">
        <p className="eyebrow">All transactions</p>
        {txns.length > 0 ? (
          <TransactionsTable transactions={txns} categories={categories} />
        ) : (
          <Card className="text-center text-sm text-[var(--muted)]">
            No transactions in this category yet.
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  raw,
  big,
}: {
  label: string;
  value?: number;
  raw?: string;
  big?: boolean;
}) {
  return (
    <Card>
      <p className="eyebrow">{label}</p>
      <p className={`mt-2 font-display tabular ${big ? "text-4xl" : "text-3xl"}`}>
        {raw ?? formatCurrency(value ?? 0)}
      </p>
    </Card>
  );
}

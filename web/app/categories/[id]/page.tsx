import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { CategoryIcon } from "@/components/category-pill";
import { MonthlySpendChart } from "@/components/charts";
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

  // Charts read oldest-first; the query returns newest-first. Chart the side
  // (received vs spent) that leads this category so the trend is meaningful.
  const chartData = months
    .map((m) => ({ month: m.month, spent: inflowLed ? m.received : m.spent }))
    .reverse();

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
            <span className="eyebrow">Monthly {headlineLabel.toLowerCase()} · 12 mo</span>
          </div>
          <div className="px-2 py-4 sm:px-4">
            <MonthlySpendChart data={chartData} />
          </div>
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { X } from "lucide-react";
import { MonthlySpendChart } from "@/components/charts";
import { TransactionsTable } from "@/components/transactions-table";
import { getCategoryDetail } from "@/lib/actions";
import type { CategoryDay, CategoryMonth, CategoryRow, TransactionRow } from "@/lib/queries";

/**
 * Inline, lazily-loaded breakdown for a single category — the monthly trend
 * chart plus its transactions. Mounted only when a row is expanded (Categories
 * and Budgets pages), so the data fetch happens on demand rather than upfront.
 */
export function CategoryDetailPanel({
  categoryId,
  categories,
  group = "spending",
}: {
  categoryId: string;
  categories: CategoryRow[];
  /** Income/transfer categories chart inflow; spending charts outflow. */
  group?: string;
}) {
  const [data, setData] = useState<{
    days: CategoryDay[];
    months: CategoryMonth[];
    txns: TransactionRow[];
  } | null>(null);
  const [error, setError] = useState(false);
  // Clicking a month bar filters the transaction list to that month ('YYYY-MM').
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getCategoryDetail(categoryId)
      .then((d) => active && setData(d))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [categoryId]);

  const visibleTxns = useMemo(
    () =>
      selectedMonth
        ? (data?.txns ?? []).filter((t) => t.date.startsWith(selectedMonth))
        : (data?.txns ?? []),
    [data, selectedMonth],
  );

  if (error) {
    return (
      <div className="px-5 py-6 text-sm text-[var(--coral)]">
        Couldn&apos;t load this category&apos;s details.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-5 py-6 text-sm text-[var(--muted)]">Loading…</div>
    );
  }

  // Mirror the full detail page: chart the side (received vs spent) that leads
  // this category, oldest-first (the query returns newest-first).
  const totalReceived = data.months.reduce((s, m) => s + m.received, 0);
  const totalSpent = data.months.reduce((s, m) => s + m.spent, 0);
  const inflowLed = group !== "spending" && totalReceived > totalSpent;
  const chartData = data.months
    .map((m) => ({ month: m.month, spent: inflowLed ? m.received : m.spent }))
    .reverse();

  return (
    <div className="space-y-4 border-t border-line/60 bg-[var(--panel-2)]/40 px-5 py-5">
      {data.months.length > 0 && (
        <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="eyebrow">
              Monthly {inflowLed ? "received" : "spent"} · 12 mo
            </span>
            <span className="text-xs text-[var(--faint)]">Click a month to filter</span>
          </div>
          <div className="px-2 py-4 sm:px-4">
            <MonthlySpendChart
              data={chartData}
              selectedMonth={selectedMonth}
              onSelectMonth={setSelectedMonth}
            />
          </div>
        </div>
      )}

      {selectedMonth && (
        <button
          onClick={() => setSelectedMonth(null)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--brass-dim)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--brass)] transition-colors hover:bg-[var(--panel-2)]"
        >
          {format(parseISO(selectedMonth + "-01"), "MMMM yyyy")}
          <X size={12} />
        </button>
      )}

      {visibleTxns.length > 0 ? (
        <TransactionsTable transactions={visibleTxns} categories={categories} />
      ) : (
        <p className="px-1 py-2 text-sm text-[var(--muted)]">
          {selectedMonth
            ? "No transactions in this category for that month."
            : "No transactions in this category yet."}
        </p>
      )}
    </div>
  );
}

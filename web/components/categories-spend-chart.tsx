"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { X } from "lucide-react";
import { DailySpendChart } from "@/components/daily-spend-chart";
import { TransactionsTable } from "@/components/transactions-table";
import { getTransactionsForDate } from "@/lib/actions";
import type { CategoryRow, TransactionRow } from "@/lib/queries";

export function CategoriesSpendChart({
  daily,
  categories,
}: {
  daily: { date: string; spent: number }[];
  categories: CategoryRow[];
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [txns, setTxns] = useState<TransactionRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedDate) {
      setTxns(null);
      return;
    }
    let active = true;
    setLoading(true);
    getTransactionsForDate(selectedDate)
      .then((rows) => {
        if (active) {
          setTxns(rows);
          setLoading(false);
        }
      })
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [selectedDate]);

  function handleSelectDate(date: string | null) {
    setSelectedDate((prev) => (prev === date ? null : date));
  }

  return (
    <div className="space-y-4">
      <DailySpendChart
        data={daily}
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
      />

      {selectedDate && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="eyebrow">
              {format(parseISO(selectedDate), "MMMM d, yyyy")}
            </p>
            <button
              onClick={() => setSelectedDate(null)}
              className="rounded-full p-0.5 text-[var(--faint)] transition hover:text-[var(--paper)]"
              aria-label="Clear date filter"
            >
              <X size={13} />
            </button>
          </div>

          {loading ? (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          ) : txns && txns.length > 0 ? (
            <TransactionsTable transactions={txns} categories={categories} />
          ) : (
            <p className="text-sm text-[var(--muted)]">No transactions on this day.</p>
          )}
        </div>
      )}
    </div>
  );
}

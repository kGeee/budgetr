"use client";

import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { X } from "lucide-react";
import { MonthlySpendChart } from "@/components/charts";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { Mark, SectionHead, Stat, StatStrip, Verdict } from "@/components/ui/statement";
import { getCategoryDetail } from "@/lib/actions";
import { categoryVerdict } from "@/lib/category-verdict";
import { formatMoney } from "@/lib/utils";
import type { CategoryDay, CategoryMonth, CategoryRow, TransactionRow } from "@/lib/queries";

const money = (v: number) => formatMoney(v, "USD");

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
      <p className="py-6 text-sm text-[var(--coral)]">
        Couldn&apos;t load this category&apos;s details.
      </p>
    );
  }

  if (!data) {
    return <p className="py-6 text-sm text-[var(--muted)]">Loading…</p>;
  }

  // Mirror the full detail page: chart the side (received vs spent) that leads
  // this category, oldest-first (the query returns newest-first).
  const totalReceived = data.months.reduce((s, m) => s + m.received, 0);
  const totalSpent = data.months.reduce((s, m) => s + m.spent, 0);
  const inflowLed = group !== "spending" && totalReceived > totalSpent;
  const chartData = data.months
    .map((m) => ({ month: m.month, spent: inflowLed ? m.received : m.spent }))
    .reverse();
  const verb = inflowLed ? "received" : "spent";
  const verdict = categoryVerdict(chartData.map((m) => ({ month: m.month, amount: m.spent })));
  const monthName = (m: string, pattern = "MMMM") => format(parseISO(m + "-01"), pattern);
  const txnCount = data.months.reduce((s, m) => s + m.count, 0);

  return (
    // Sits straight on the canvas: a sentence, the figures it is made of on one
    // rule, the twelve-month chart, then the ledger under its own ruled head.
    <div className="space-y-7 pt-5">
      {verdict && (
        <div className="space-y-4">
          <Verdict>
            {monthName(verdict.month)} is at{" "}
            <Mark tone={verdict.tone === "muted" ? "default" : verdict.tone}>
              {money(verdict.current)}
            </Mark>
            {verdict.usual != null && verdict.usual > 0 ? (
              <>, against a usual month of about {money(verdict.usual)}.</>
            ) : (
              <>, the only month on record so far.</>
            )}
          </Verdict>
          <StatStrip>
            <Stat
              label={`${inflowLed ? "Received" : "Spent"} · ${data.months.length} mo`}
              value={money(verdict.total)}
            />
            <Stat label="Avg / month" value={money(verdict.average)} />
            <Stat label="Transactions" value={txnCount.toLocaleString()} />
          </StatStrip>
        </div>
      )}

      {data.months.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="eyebrow">Monthly {verb} · 12 mo</span>
            <span className="text-xs text-[var(--muted)]">
              Click a month to filter the list below
            </span>
          </div>
          <MonthlySpendChart
            data={chartData}
            selectedMonth={selectedMonth}
            onSelectMonth={setSelectedMonth}
          />
        </div>
      )}

      <section className="space-y-3">
        <SectionHead
          title={selectedMonth ? monthName(selectedMonth, "MMMM yyyy") : "Transactions"}
          count={
            selectedMonth
              ? `${visibleTxns.length} of ${data.txns.length}`
              : data.txns.length
          }
          action={
            selectedMonth && (
              <button
                onClick={() => setSelectedMonth(null)}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3 text-xs text-[var(--paper)] transition-colors hover:bg-[var(--panel-2)]"
              >
                Show all {data.txns.length}
                <X size={12} aria-hidden />
              </button>
            )
          }
        />
        {visibleTxns.length > 0 ? (
          <>
            <TransactionsTable transactions={visibleTxns} categories={categories} />
            <p className="border-t border-line pt-3 text-sm text-[var(--muted)]">
              {selectedMonth
                ? `Filtered to ${monthName(selectedMonth)}.`
                : "Every transaction in this category."}{" "}
              Same columns and row actions as the Transactions ledger.
            </p>
          </>
        ) : (
          <p className="py-2 text-sm text-[var(--muted)]">
            {selectedMonth
              ? "No transactions in this category for that month."
              : "No transactions in this category yet."}
          </p>
        )}
      </section>
    </div>
  );
}

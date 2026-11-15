import { GitMerge } from "lucide-react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { MonthlySpendChart } from "@/components/charts";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import {
  MergeVendorButton,
  VendorGroupDetail,
  VendorMergeProvider,
} from "@/components/transactions/vendor-merge-dialog";
import { Hero, Mark, SectionHead, Stat, StatStrip } from "@/components/ui/statement";
import {
  getCategories,
  getVendorCategoryBreakdown,
  getVendorGroups,
  getVendorMonthlySpend,
  getVendors,
  getVendorTransactions,
  toVendorCandidates,
} from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";
import { spendingHref } from "./href";
import { CategoryDot, categoryFill } from "./ruled";

/**
 * Spending → By vendor: the all-time vendor directory, the merge dialog, and
 * the selected vendor's trend + transactions. `v` is the selected vendor key
 * (a raw vendor key or a vendor-group id), from ?vendor=.
 */
export function VendorView({ v }: { v?: string }) {
  const vendors = getVendors();
  const groups = getVendorGroups();
  const selected = v ? vendors.find((x) => x.vendorKey === v) : undefined;

  const txns = selected ? getVendorTransactions(selected.vendorKey) : [];
  const categories = selected ? getCategories() : [];
  const monthly = selected ? getVendorMonthlySpend(selected.vendorKey) : [];
  const breakdown = selected ? getVendorCategoryBreakdown(selected.vendorKey) : [];

  const avg = selected && selected.count > 0 ? selected.spent / selected.count : 0;

  // Two lists, not one. Card payments and moves between your own accounts are
  // the three largest rows on this page and none of them is a merchant, so
  // ranking everything together buries real spending below bank plumbing.
  const merchants = vendors.filter((x) => !x.isMovement);
  const movement = vendors.filter((x) => x.isMovement);
  const merchantTotal = merchants.reduce((sum, x) => sum + x.spent, 0);
  const movementTotal = movement.reduce((sum, x) => sum + x.spent, 0);
  const mostFrequent = [...merchants].sort((a, b) => b.count - a.count)[0];

  const breakdownTotal = breakdown.reduce((sum, b) => sum + b.total, 0);
  const row = (vendor: (typeof vendors)[number]) => {
    const active = vendor.vendorKey === v;
    const isGroup = vendor.groupId !== null;
    return (
      <li
        key={vendor.vendorKey}
        className={`group/row flex items-center gap-2 border-b border-line transition-colors hover:bg-[var(--panel)] ${
          active ? "bg-[var(--panel)]" : ""
        }`}
      >
        <Link
          href={spendingHref({ view: "vendor", vendor: vendor.vendorKey })}
          scroll={false}
          aria-current={active ? "true" : undefined}
          className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 border-l-2 py-2 pl-2.5 ${
            active ? "border-l-[var(--brass)]" : "border-l-transparent"
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{vendor.displayName}</span>
            <span className="block text-xs text-[var(--muted)]">
              {isGroup && (
                <span className="text-[var(--brass)]">{vendor.members.length} vendors · </span>
              )}
              {vendor.count} {vendor.count === 1 ? "txn" : "txns"} · last {vendor.lastDate}
            </span>
          </span>
          <span
            className={`mono shrink-0 text-sm tabular ${
              vendor.isMovement ? "text-[var(--muted)]" : ""
            }`}
          >
            {formatCurrency(vendor.spent)}
          </span>
        </Link>
        {/* Merge — only for standalone (non-group) vendor rows. The slot keeps
            every figure on the same right edge whether or not it is filled. */}
        <span className="grid h-11 w-9 shrink-0 place-items-center">
          {!isGroup && (
            <MergeVendorButton
              vendorKey={vendor.vendorKey}
              vendorName={vendor.displayName}
              currentGroupId={vendor.groupId}
            />
          )}
        </span>
      </li>
    );
  };

  return (
    <>
      {/* The directory's one figure is what went to real merchants; transfers
          and card payments are named in the sentence, apart from it. */}
      <section aria-label="Vendor spending, all time">
        <Hero
          eyebrow="Spent with merchants · all time"
          figure={formatCurrency(merchantTotal)}
          verdict={
            <>
              Across <Mark tone="default">{merchants.length}</Mark>{" "}
              {merchants.length === 1 ? "merchant" : "merchants"}.
              {mostFrequent && (
                <>
                  {" "}
                  The most frequent is <Mark tone="brass">{mostFrequent.displayName}</Mark> at{" "}
                  {mostFrequent.count} {mostFrequent.count === 1 ? "visit" : "visits"}.
                </>
              )}
              {movement.length > 0 && (
                <span className="text-[var(--muted)]">
                  {" "}
                  A further {formatCurrency(movementTotal)} across {movement.length} transfer and
                  card-payment {movement.length === 1 ? "row" : "rows"} is listed separately; it
                  is not spending.
                </span>
              )}
            </>
          }
          className="[&>p:last-child]:max-w-[68ch]"
        />
      </section>

      <div className="flex flex-wrap gap-x-12 gap-y-9">
        {/* Vendor list */}
        <section aria-label="Vendor list" className="min-w-0 flex-[2_1_360px]">
          {/* The merge dialog's candidate + group lists are the same for every
              row, so they're provided once here rather than passed per row. */}
          <VendorMergeProvider candidates={toVendorCandidates(vendors)} groups={groups}>
            <SectionHead
              title="Merchants"
              count={merchants.length}
              action={<span className="text-xs text-[var(--muted)]">spent · merge</span>}
            />
            {merchants.length > 0 && (
              <ul className="lg:max-h-[72vh] lg:overflow-y-auto">{merchants.map(row)}</ul>
            )}
            {vendors.length === 0 && (
              <p className="py-8 text-sm text-[var(--muted)]">
                No vendors yet — connect an account and hit Sync.
              </p>
            )}

            {movement.length > 0 && (
              <>
                <SectionHead
                  className="pt-7"
                  title="Money movement"
                  count={`not spending · ${movement.length}`}
                />
                <ul>{movement.map(row)}</ul>
              </>
            )}
          </VendorMergeProvider>
        </section>

        {/* Selected vendor detail: summary + visualizations */}
        <section aria-label="Selected vendor" className="min-w-0 flex-[3_1_480px]">
          {selected ? (
            <div className="flex flex-col gap-7">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line-strong)] pb-3.5">
                <div className="min-w-0">
                  <p className="eyebrow">
                    Vendor
                    {selected.groupId && ` · group of ${selected.members.length}`}
                  </p>
                  <h2 className="mt-1 font-display text-3xl tracking-tight">
                    {selected.displayName}
                  </h2>
                </div>
                <div className="text-right">
                  <p className="font-display text-3xl tabular">{formatCurrency(selected.spent)}</p>
                  <p className="text-xs text-[var(--muted)]">
                    across {selected.count} transaction{selected.count === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <StatStrip className="border-b border-t-0 pb-3.5 pt-0">
                <Stat label="Avg / txn" value={formatCurrency(avg)} />
                <Stat label="Active months" value={String(monthly.length)} />
                <Stat label="Last seen" value={selected.lastDate} />
              </StatStrip>

              {/* Group management panel */}
              {selected.groupId && (
                <VendorGroupDetail
                  groupId={selected.groupId}
                  groupName={selected.displayName}
                  members={selected.members}
                />
              )}

              <div className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="eyebrow">Monthly spend</span>
                  {monthly.length > 0 && (
                    <span className="mono text-[11px] text-[var(--muted)]">
                      {format(parseISO(monthly[0].month + "-01"), "MMM")} –{" "}
                      {format(parseISO(monthly[monthly.length - 1].month + "-01"), "MMM yyyy")}
                    </span>
                  )}
                </div>
                {monthly.length > 0 ? (
                  <MonthlySpendChart data={monthly} />
                ) : (
                  <p className="py-10 text-sm text-[var(--muted)]">
                    No dated activity to chart yet.
                  </p>
                )}
              </div>

              {breakdown.length > 1 && breakdownTotal > 0 && (
                <div className="flex flex-col gap-2.5">
                  <span className="eyebrow">Category split</span>
                  <div
                    role="img"
                    aria-label={breakdown
                      .map((b) => `${b.category} ${Math.round((b.total / breakdownTotal) * 100)} percent`)
                      .join(", ")}
                    className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
                  >
                    {breakdown.map((b) => (
                      <span
                        key={b.categoryId ?? b.category}
                        className="tint"
                        style={{
                          ...categoryFill(b.categoryId ?? b.category),
                          width: `${(b.total / breakdownTotal) * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                  <ul className="mono flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
                    {breakdown.map((b) => (
                      <li key={b.categoryId ?? b.category} className="flex items-center gap-2">
                        <CategoryDot id={b.categoryId ?? b.category} />
                        <span className="font-sans text-[var(--muted)]">{b.category}</span>
                        {formatCurrency(b.total)} · {Math.round((b.total / breakdownTotal) * 100)}%
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="border-y border-line py-8">
              <p className="font-display text-lg">Select a vendor</p>
              <p className="mt-1 max-w-[52ch] text-sm text-[var(--muted)]">
                Its spend trend, category split and every transaction open here. Hover a vendor
                and click <GitMerge size={12} className="inline" aria-label="merge" /> to combine
                similar ones.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Full-width transaction log below — room to read every column cleanly */}
      {selected && (
        <section aria-label={`Transactions for ${selected.displayName}`} className="space-y-3">
          <SectionHead title="Transactions" count={txns.length} />
          <TransactionsTable transactions={txns} categories={categories} />
          <p className="text-[13px] text-[var(--muted)]">
            Same columns and row actions as the Transactions ledger.
          </p>
        </section>
      )}
    </>
  );
}

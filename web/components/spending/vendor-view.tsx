import { ChevronRight, GitMerge, Store } from "lucide-react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { CategoryChart, MonthlySpendChart } from "@/components/charts";
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

  return (
    <>
      {/* The directory's one figure is what went to real merchants; transfers
          and card payments are counted on the rule below, apart from it. */}
      <section className="space-y-5" aria-label="Vendor spending, all time">
        <Hero
          eyebrow="Spent with merchants · all time"
          figure={formatCurrency(merchantTotal)}
          verdict={
            <>
              Across <Mark tone="default">{merchants.length}</Mark>{" "}
              {merchants.length === 1 ? "merchant" : "merchants"}
              {mostFrequent && (
                <>
                  {" "}
                  — most frequent is <Mark tone="brass">{mostFrequent.displayName}</Mark> at{" "}
                  {mostFrequent.count} {mostFrequent.count === 1 ? "visit" : "visits"}
                </>
              )}
              .
            </>
          }
        />
        <StatStrip>
          <Stat label="Merchants" value={merchants.length.toLocaleString()} />
          {mostFrequent && (
            <Stat
              label="Most frequent"
              value={mostFrequent.displayName}
              sub={`${mostFrequent.count} ${mostFrequent.count === 1 ? "visit" : "visits"}`}
            />
          )}
          {movement.length > 0 && (
            <Stat
              label="Money movement"
              tone="muted"
              value={formatCurrency(movementTotal)}
              sub={`${movement.length} transfer and card-payment ${
                movement.length === 1 ? "row" : "rows"
              }, listed separately below — not spending`}
            />
          )}
        </StatStrip>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Vendor list */}
        <div className="lg:col-span-2">
          {/* The merge dialog's candidate + group lists are the same for every
              row, so they're provided once here rather than passed per row. */}
          <VendorMergeProvider candidates={toVendorCandidates(vendors)} groups={groups}>
          <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
            <ul className="max-h-[70vh] overflow-y-auto">
              {merchants.length > 0 && (
                <li className="sticky top-0 z-10 border-b border-line bg-[var(--panel)] px-4 py-2">
                  <span className="eyebrow">Merchants · {merchants.length}</span>
                </li>
              )}
              {[...merchants, ...movement].map((vendor, idx) => {
                const startsMovement = idx === merchants.length && movement.length > 0;
                const active = vendor.vendorKey === v;
                const isGroup = vendor.groupId !== null;
                return (
                  <li key={vendor.vendorKey} className="group/row">
                    {startsMovement && (
                      <div className="sticky top-0 z-10 border-y border-line bg-[var(--panel)] px-4 py-2">
                        <span className="eyebrow">
                          Money movement · not spending · {movement.length}
                        </span>
                      </div>
                    )}
                    <Link
                      href={spendingHref({ view: "vendor", vendor: vendor.vendorKey })}
                      scroll={false}
                      className={`flex items-center gap-3 border-b border-l-2 border-line/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-[var(--panel-2)] ${
                        active
                          ? "border-l-[var(--brass)] bg-[var(--panel-2)]"
                          : "border-l-transparent"
                      }`}
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] ${isGroup ? "text-[var(--brass)]" : "text-[var(--muted)]"}`}>
                        {isGroup ? <GitMerge size={14} /> : <Store size={14} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{vendor.displayName}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {isGroup && (
                            <span className="mr-1 text-[var(--brass)]">
                              {vendor.members.length} vendors ·{" "}
                            </span>
                          )}
                          {vendor.count} {vendor.count === 1 ? "txn" : "txns"} · last {vendor.lastDate}
                        </p>
                      </div>
                      <span
                        className={`mono shrink-0 text-sm ${
                          vendor.isMovement ? "text-[var(--muted)]" : ""
                        }`}
                      >
                        {formatCurrency(vendor.spent)}
                      </span>

                      {/* Merge button — only for standalone (non-group) vendor rows */}
                      {!isGroup && (
                        <MergeVendorButton
                          vendorKey={vendor.vendorKey}
                          vendorName={vendor.displayName}
                          currentGroupId={vendor.groupId}
                        />
                      )}

                      <ChevronRight
                        size={15}
                        className={`shrink-0 ${active ? "text-[var(--brass)]" : "text-[var(--faint)]"}`}
                      />
                    </Link>
                  </li>
                );
              })}
              {vendors.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                  No vendors yet — connect an account and hit Sync.
                </li>
              )}
            </ul>
          </div>
          </VendorMergeProvider>
        </div>

        {/* Selected vendor detail: summary + visualizations */}
        <div className="lg:col-span-3">
          {selected ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line-strong)] pb-3">
                <div className="min-w-0">
                  <p className="eyebrow">Vendor</p>
                  <h2 className="mt-1 font-display text-2xl tracking-tight">
                    {selected.displayName}
                  </h2>
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl tabular">{formatCurrency(selected.spent)}</p>
                  <p className="text-xs text-[var(--muted)]">across {selected.count} transactions</p>
                </div>
              </div>

              <StatStrip className="border-t-0 pt-0">
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

              <section className="space-y-4 pt-2">
                <SectionHead
                  title="Monthly spend"
                  action={
                    monthly.length > 0 && (
                      <span className="text-xs text-[var(--muted)]">
                        {format(parseISO(monthly[0].month + "-01"), "MMM")} –{" "}
                        {format(parseISO(monthly[monthly.length - 1].month + "-01"), "MMM yyyy")}
                      </span>
                    )
                  }
                />
                {monthly.length > 0 ? (
                  <MonthlySpendChart data={monthly} />
                ) : (
                  <p className="py-10 text-center text-sm text-[var(--muted)]">
                    No dated activity to chart yet.
                  </p>
                )}
              </section>

              {breakdown.length > 1 && (
                <section className="space-y-4 pt-2">
                  <SectionHead title="Category split" />
                  <CategoryChart data={breakdown} />
                </section>
              )}
            </div>
          ) : (
            <div className="grid h-full min-h-[200px] place-items-center rounded-[var(--radius)] border border-dashed border-line p-10 text-center">
              <div className="space-y-1">
                <p className="text-sm text-[var(--muted)]">
                  Select a vendor to see spend trends and every transaction over time.
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Hover a vendor and click <GitMerge size={11} className="inline" /> to combine similar ones.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-width transaction log below — room to read every column cleanly */}
      {selected && (
        <div className="space-y-3">
          <SectionHead title="Transactions" count={txns.length} />
          <TransactionsTable transactions={txns} categories={categories} />
        </div>
      )}
    </>
  );
}

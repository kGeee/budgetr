import { ChevronRight, GitMerge, Store } from "lucide-react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { PageHead } from "@/components/page-head";
import { CategoryChart, MonthlySpendChart } from "@/components/charts";
import { TransactionsTable } from "@/components/transactions-table";
import {
  MergeVendorButton,
  VendorGroupDetail,
  VendorMergeProvider,
} from "@/components/vendor-merge-dialog";
import { Card } from "@/components/ui/card";
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

export const dynamic = "force-dynamic";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
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
    <div className="space-y-7">
      <PageHead title="Vendors" />
      <div className="-mt-3 space-y-1">
        <p className="text-sm">
          <span className="font-medium text-[var(--paper)]">
            {formatCurrency(merchantTotal)}
          </span>{" "}
          <span className="text-[var(--muted)]">
            across {merchants.length} {merchants.length === 1 ? "merchant" : "merchants"}
            {mostFrequent && (
              <>
                {" "}
                — most frequent is{" "}
                <span className="text-[var(--paper)]">{mostFrequent.displayName}</span> at{" "}
                {mostFrequent.count} {mostFrequent.count === 1 ? "visit" : "visits"}
              </>
            )}
            .
          </span>
        </p>
        {movement.length > 0 && (
          <p className="text-xs text-[var(--muted)]">
            A further {formatCurrency(movementTotal)} across {movement.length} transfer and
            card-payment {movement.length === 1 ? "row" : "rows"}, listed separately below — not
            spending.
          </p>
        )}
      </div>

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
                      href={{ pathname: "/vendors", query: { v: vendor.vendorKey } }}
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
              <div className="flex items-end justify-between gap-4 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-5">
                <div>
                  <p className="eyebrow">Vendor</p>
                  <p className="mt-1 font-display text-2xl">{selected.displayName}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl tabular">{formatCurrency(selected.spent)}</p>
                  <p className="text-xs text-[var(--muted)]">across {selected.count} transactions</p>
                </div>
              </div>

              {/* Group management panel */}
              {selected.groupId && (
                <VendorGroupDetail
                  groupId={selected.groupId}
                  groupName={selected.displayName}
                  members={selected.members}
                />
              )}

              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="Avg / txn" value={formatCurrency(avg)} />
                <MiniStat label="Active months" value={String(monthly.length)} />
                <MiniStat label="Last seen" value={selected.lastDate} mono />
              </div>

              <Card className="p-0">
                <div className="flex items-baseline justify-between border-b border-line px-5 py-3.5">
                  <span className="eyebrow">Monthly spend</span>
                  {monthly.length > 0 && (
                    <span className="text-xs text-[var(--faint)]">
                      {format(parseISO(monthly[0].month + "-01"), "MMM")} –{" "}
                      {format(parseISO(monthly[monthly.length - 1].month + "-01"), "MMM yyyy")}
                    </span>
                  )}
                </div>
                <div className="px-2 py-4 sm:px-4">
                  {monthly.length > 0 ? (
                    <MonthlySpendChart data={monthly} />
                  ) : (
                    <p className="py-10 text-center text-sm text-[var(--muted)]">
                      No dated activity to chart yet.
                    </p>
                  )}
                </div>
              </Card>

              {breakdown.length > 1 && (
                <Card>
                  <p className="eyebrow mb-4">Category split</p>
                  <CategoryChart data={breakdown} />
                </Card>
              )}
            </div>
          ) : (
            <div className="grid h-full min-h-[200px] place-items-center rounded-[var(--radius)] border border-dashed border-line bg-[var(--panel)] p-10 text-center">
              <div className="space-y-1">
                <p className="text-sm text-[var(--muted)]">
                  Select a vendor to see spend trends and every transaction over time.
                </p>
                <p className="text-xs text-[var(--faint)]">
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
          <p className="eyebrow">
            Transactions · {txns.length}
          </p>
          <TransactionsTable transactions={txns} categories={categories} />
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-4">
      <p className="eyebrow">{label}</p>
      <p className={`mt-1.5 text-lg ${mono ? "mono" : "font-display tabular"}`}>{value}</p>
    </div>
  );
}

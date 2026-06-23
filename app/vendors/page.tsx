import Link from "next/link";
import { ChevronRight, Store } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { TransactionsTable } from "@/components/transactions-table";
import { getCategories, getVendors, getVendorTransactions } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  const { v } = await searchParams;
  const vendors = getVendors();
  const selected = v ? vendors.find((x) => x.vendorKey === v) : undefined;
  const txns = selected ? getVendorTransactions(selected.vendorKey) : [];
  const categories = selected ? getCategories() : [];

  return (
    <div className="space-y-7">
      <PageHead title="Vendors" />
      <p className="-mt-3 text-sm text-[var(--muted)]">
        {vendors.length} vendors · grouped from your transaction history
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Vendor list */}
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
            <ul className="max-h-[70vh] overflow-y-auto">
              {vendors.map((vendor) => {
                const active = vendor.vendorKey === v;
                return (
                  <li key={vendor.vendorKey}>
                    <Link
                      href={{ pathname: "/vendors", query: { v: vendor.vendorKey } }}
                      scroll={false}
                      className={`flex items-center gap-3 border-b border-line/60 px-4 py-3 transition-colors last:border-0 hover:bg-[var(--panel-2)] ${
                        active ? "bg-[var(--panel-2)]" : ""
                      }`}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--brass)]">
                        <Store size={14} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{vendor.displayName}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {vendor.count} {vendor.count === 1 ? "txn" : "txns"} · last {vendor.lastDate}
                        </p>
                      </div>
                      <span className="mono shrink-0 text-sm">{formatCurrency(vendor.spent)}</span>
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
        </div>

        {/* Selected vendor's transactions */}
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
              <TransactionsTable transactions={txns} categories={categories} />
            </div>
          ) : (
            <div className="grid h-full min-h-[200px] place-items-center rounded-[var(--radius)] border border-dashed border-line bg-[var(--panel)] p-10 text-center">
              <p className="text-sm text-[var(--muted)]">
                Select a vendor to see every transaction from them over time.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

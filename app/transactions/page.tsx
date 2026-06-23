import { PageHead } from "@/components/page-head";
import { TransactionsTable } from "@/components/transactions-table";
import { getCategories, getRecentTransactions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const txns = getRecentTransactions(200);
  const categories = getCategories();
  const unreviewed = txns.filter((t) => !t.reviewed).length;

  return (
    <div className="space-y-7">
      <PageHead title="Transactions" />
      <p className="-mt-3 text-sm text-[var(--muted)]">
        {txns.length} most recent {txns.length === 1 ? "entry" : "entries"}
        {unreviewed > 0 && (
          <span className="text-[var(--brass)]"> · {unreviewed} to review</span>
        )}
      </p>

      <TransactionsTable transactions={txns} categories={categories} />
    </div>
  );
}

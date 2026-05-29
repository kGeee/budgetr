import { Card } from "@/components/ui/card";
import { getRecentTransactions, prettyCategory } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const txns = getRecentTransactions(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Transactions</h1>
        <p className="text-sm text-[var(--muted)]">Most recent {txns.length} transactions</p>
      </div>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-5 py-3 font-medium">Category</th>
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {txns.map((t) => (
              <tr key={t.id} className="hover:bg-[var(--surface-2)]">
                <td className="whitespace-nowrap px-5 py-3 text-[var(--muted)]">{t.date}</td>
                <td className="px-5 py-3">
                  {t.merchantName ?? t.name}
                  {t.pending && (
                    <span className="ml-2 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs text-[var(--muted)]">
                      pending
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-[var(--muted)]">{prettyCategory(t.category)}</td>
                <td className="px-5 py-3 text-[var(--muted)]">{t.accountName}</td>
                <td
                  className={`tabular whitespace-nowrap px-5 py-3 text-right ${
                    t.amount < 0 ? "text-[var(--positive)]" : ""
                  }`}
                >
                  {t.amount < 0 ? "+" : "-"}
                  {formatCurrency(Math.abs(t.amount), t.currency ?? "USD")}
                </td>
              </tr>
            ))}
            {txns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-[var(--muted)]">
                  No transactions yet — connect an account and hit Sync.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

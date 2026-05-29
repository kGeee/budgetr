import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CashflowChart, CategoryChart, NetWorthChart } from "@/components/charts";
import { PlaidLink } from "@/components/plaid-link";
import {
  getItems,
  getMonthlyCashflow,
  getNetWorth,
  getNetWorthSeries,
  getRecentTransactions,
  getSpendingByCategory,
  prettyCategory,
} from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const items = getItems();
  const nw = getNetWorth();
  const series = getNetWorthSeries();
  const cashflow = getMonthlyCashflow();
  const categories = getSpendingByCategory(30);
  const recent = getRecentTransactions(8);

  const thisMonth = cashflow[cashflow.length - 1];

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="mb-2 text-2xl font-semibold">Welcome to budgetr</h1>
        <p className="mb-6 text-sm text-[var(--muted)]">
          Connect your accounts to start tracking net worth, spending, and income. In Plaid
          Sandbox, search any bank and log in with <code>user_good</code> / <code>pass_good</code>.
        </p>
        <div className="flex justify-center">
          <PlaidLink />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Net worth" value={nw.net} accent />
        <Stat label="Assets" value={nw.assets} />
        <Stat label="Liabilities" value={-nw.liabilities} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Net worth over time</CardTitle>
        </CardHeader>
        <NetWorthChart data={series} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Income vs spending (monthly)</CardTitle>
            {thisMonth && (
              <span className="text-xs text-[var(--muted)]">
                This month: net {formatCurrency(thisMonth.income - thisMonth.expenses)}
              </span>
            )}
          </CardHeader>
          <CashflowChart data={cashflow} />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spending by category (30d)</CardTitle>
          </CardHeader>
          <CategoryChart data={categories} />
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <ul className="divide-y">
          {recent.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.merchantName ?? t.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {t.date} · {prettyCategory(t.category)} · {t.accountName}
                </p>
              </div>
              <span
                className={`tabular shrink-0 ${t.amount < 0 ? "text-[var(--positive)]" : ""}`}
              >
                {t.amount < 0 ? "+" : "-"}
                {formatCurrency(Math.abs(t.amount), t.currency ?? "USD")}
              </span>
            </li>
          ))}
          {recent.length === 0 && (
            <li className="py-4 text-sm text-[var(--muted)]">No transactions yet — hit Sync.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <p
        className={`tabular mt-1 text-2xl font-semibold ${
          accent ? "text-[var(--accent)]" : value < 0 ? "text-[var(--negative)]" : ""
        }`}
      >
        {formatCurrency(value)}
      </p>
    </Card>
  );
}

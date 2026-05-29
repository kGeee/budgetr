import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getHoldings } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function InvestmentsPage() {
  const holdings = getHoldings();
  const total = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  const totalCost = holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  const gain = total - totalCost;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Investments</h1>
        <p className="text-sm text-[var(--muted)]">{holdings.length} holdings</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Market value" value={total} />
        <Stat label="Cost basis" value={totalCost} />
        <Stat label="Unrealized gain" value={gain} signed />
      </div>

      <Card className="p-0">
        <CardHeader className="px-5 pt-5">
          <CardTitle>Holdings</CardTitle>
        </CardHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="px-5 py-3 font-medium">Security</th>
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 text-right font-medium">Qty</th>
              <th className="px-5 py-3 text-right font-medium">Price</th>
              <th className="px-5 py-3 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {holdings.map((h) => (
              <tr key={h.id} className="hover:bg-[var(--surface-2)]">
                <td className="px-5 py-3">
                  <span className="font-medium">{h.ticker ?? "—"}</span>
                  <span className="ml-2 text-[var(--muted)]">{h.securityName}</span>
                </td>
                <td className="px-5 py-3 text-[var(--muted)]">{h.accountName}</td>
                <td className="tabular px-5 py-3 text-right">{h.quantity?.toLocaleString()}</td>
                <td className="tabular px-5 py-3 text-right">
                  {formatCurrency(h.price ?? 0, h.currency ?? "USD")}
                </td>
                <td className="tabular px-5 py-3 text-right font-medium">
                  {formatCurrency(h.value ?? 0, h.currency ?? "USD")}
                </td>
              </tr>
            ))}
            {holdings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-center text-[var(--muted)]">
                  No holdings yet. Connect a brokerage account and hit Sync.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Stat({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <p
        className={`tabular mt-1 text-2xl font-semibold ${
          signed ? (value >= 0 ? "text-[var(--positive)]" : "text-[var(--negative)]") : ""
        }`}
      >
        {signed && value >= 0 ? "+" : ""}
        {formatCurrency(value)}
      </p>
    </Card>
  );
}

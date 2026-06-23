import { Card } from "@/components/ui/card";
import { PageHead } from "@/components/page-head";
import { getHoldings } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function InvestmentsPage() {
  const holdings = getHoldings();
  const total = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  const totalCost = holdings.reduce((s, h) => s + (h.costBasis ?? 0), 0);
  const gain = total - totalCost;
  const gainPct = totalCost !== 0 ? (gain / totalCost) * 100 : 0;

  return (
    <div className="space-y-7">
      <PageHead title="Investments" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Market value" value={total} big />
        <Stat label="Cost basis" value={totalCost} />
        <Stat label="Unrealized gain" value={gain} signed pct={gainPct} />
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="eyebrow">Holdings</span>
          <span className="text-xs text-[var(--muted)]">
            {holdings.length} {holdings.length === 1 ? "position" : "positions"}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {["Security", "Account", "Qty", "Price", "Value"].map((h, i) => (
                <th
                  key={h}
                  className={`px-6 py-3.5 eyebrow font-medium ${i >= 2 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr
                key={h.id}
                className="border-b border-line/60 last:border-0 transition-colors hover:bg-[var(--panel-2)]"
              >
                <td className="px-6 py-3.5">
                  <span className="font-medium text-[var(--brass)]">{h.ticker ?? "—"}</span>
                  <span className="ml-2 text-[var(--muted)]">{h.securityName}</span>
                </td>
                <td className="px-6 py-3.5 text-[var(--muted)]">{h.accountName}</td>
                <td className="mono px-6 py-3.5 text-right text-[var(--muted)]">
                  {h.quantity?.toLocaleString()}
                </td>
                <td className="mono px-6 py-3.5 text-right text-[var(--muted)]">
                  {formatCurrency(h.price ?? 0, h.currency ?? "USD")}
                </td>
                <td className="mono px-6 py-3.5 text-right">
                  {formatCurrency(h.value ?? 0, h.currency ?? "USD")}
                </td>
              </tr>
            ))}
            {holdings.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-[var(--muted)]">
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

function Stat({
  label,
  value,
  big,
  signed,
  pct,
}: {
  label: string;
  value: number;
  big?: boolean;
  signed?: boolean;
  pct?: number;
}) {
  const positive = value >= 0;
  const color = signed ? (positive ? "text-[var(--jade)]" : "text-[var(--coral)]") : "";
  return (
    <Card>
      <p className="eyebrow">{label}</p>
      <p className={`mt-2 font-display tabular ${big ? "text-4xl" : "text-3xl"} ${color}`}>
        {signed && positive ? "+" : ""}
        {formatCurrency(value)}
      </p>
      {signed && pct !== undefined && (
        <p className={`mono mt-1 text-sm ${color}`}>
          {positive ? "+" : "−"}
          {Math.abs(pct).toFixed(2)}%
        </p>
      )}
    </Card>
  );
}

import type { IncomeStatement } from "@/lib/fundamentals/income-statement";
import { cn } from "@/lib/utils";

/** $391.0B / $742M — statement-scale money, same rounding as the Sankey labels. */
export function fmtStatementMoney(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  return `${sign}$${(abs / 1e6).toFixed(0)}M`;
}

/**
 * The income statement as four bars on one scale: revenue, then what was left
 * after each layer of cost. Each bar's width is its share of revenue, so the
 * three margins can be read off the bars without the figures.
 */
export function IncomeBars({ is }: { is: IncomeStatement }) {
  const rows = [
    { label: "Revenue", less: "", value: is.revenue, revenue: true },
    {
      label: "Gross profit",
      less: `after ${fmtStatementMoney(is.costOfRevenue)} cost of revenue`,
      value: is.grossProfit,
    },
    {
      label: "Operating income",
      less: `after ${fmtStatementMoney(is.operatingExpenses)} operating expenses`,
      value: is.operatingIncome,
    },
    {
      label: "Net income",
      less: `after ${fmtStatementMoney(is.operatingIncome - is.netIncome)} tax and other`,
      value: is.netIncome,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => {
        const share = is.revenue ? Math.abs(r.value) / Math.abs(is.revenue) : 0;
        return (
          <div key={r.label} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap justify-between gap-x-3">
              <span className="font-medium">
                {r.label}{" "}
                {r.less && <span className="text-xs font-normal text-[var(--muted)]">{r.less}</span>}
              </span>
              <span className={cn("mono tabular", r.value < 0 && "text-[var(--coral)]")}>
                {fmtStatementMoney(r.value)}
              </span>
            </div>
            <div className="h-3.5 overflow-hidden rounded bg-[var(--panel)]">
              <span
                className={cn(
                  "block h-3.5 rounded",
                  r.revenue
                    ? "bg-[var(--brass)]"
                    : r.value < 0
                      ? "bg-[var(--coral)]"
                      : "bg-[var(--jade)]",
                )}
                style={{ width: `${Math.min(100, share * 100)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { CategoryIcon } from "@/components/category-pill";
import { formatCurrency } from "@/lib/utils";
import type { BudgetRow } from "@/lib/queries";

/**
 * A single category's monthly budget progress. Jade while under budget,
 * coral once spend exceeds the limit. `trailing` lets callers swap the
 * right-hand readout (e.g. an editable input on the budgets page).
 */
export function BudgetBar({
  row,
  trailing,
}: {
  row: BudgetRow;
  trailing?: React.ReactNode;
}) {
  const { budget, spent, remaining } = row;
  const over = budget != null && spent > budget;
  const pct = budget && budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--brass)]">
          <CategoryIcon icon={row.icon} size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
        {trailing ?? (
          <span className="mono shrink-0 text-sm">
            <span className={over ? "text-[var(--coral)]" : "text-[var(--paper)]"}>
              {formatCurrency(spent)}
            </span>
            {budget != null && (
              <span className="text-[var(--muted)]"> / {formatCurrency(budget)}</span>
            )}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3 pl-11">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
          <div
            className={`h-full rounded-full transition-all ${over ? "bg-[var(--coral)]" : "bg-[var(--jade)]"}`}
            style={{ width: `${budget ? Math.max(pct, 2) : 0}%` }}
          />
        </div>
        {budget != null ? (
          <span
            className={`mono shrink-0 text-xs ${over ? "text-[var(--coral)]" : "text-[var(--muted)]"}`}
          >
            {over
              ? `${formatCurrency(Math.abs(remaining ?? 0))} over`
              : `${formatCurrency(remaining ?? 0)} left`}
          </span>
        ) : (
          <span className="shrink-0 text-xs text-[var(--faint)]">No budget</span>
        )}
      </div>
    </div>
  );
}

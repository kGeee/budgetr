import { CategoryIcon } from "@/components/category-pill";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { CategorySpendVsAverage } from "@/lib/queries";

/**
 * Spending by category, ranked and compared.
 *
 * The page previously listed every category in management order, so four of
 * eleven rows carried a dash and the eye had to skip them to find the four that
 * mattered — and a figure like "$1,370.15 on Food & Drink" sat with nothing to
 * compare it to. Ranking, a bar, and a delta against the category's own trailing
 * average are what turn the same numbers into a signal.
 *
 * Bars are kept because relative size across categories is the one thing this
 * page shows better than any other, and it was all text.
 */
export function CategorySpendSummary({
  rows,
  days = 30,
}: {
  rows: CategorySpendVsAverage[];
  days?: number;
}) {
  const active = rows.filter((r) => r.recent > 0);
  const dormant = rows.filter((r) => r.recent === 0);
  const total = active.reduce((sum, r) => sum + r.recent, 0);
  const max = active.length > 0 ? active[0].recent : 0;

  // The most interesting mover, for the headline sentence: biggest relative
  // change on a category that's actually material.
  const mover = active
    .filter((r) => r.delta !== null && Math.abs(r.delta) >= 0.15 && r.recent >= total * 0.05)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!))[0];

  if (active.length === 0) {
    return (
      <Card>
        <p className="eyebrow">Spending by category · last {days} days</p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          No settled spending in this window.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-5">
      <div>
        <p className="eyebrow">Spending by category · last {days} days</p>
        <p className="display-2 mt-1.5 font-display text-4xl tabular">
          {formatCurrency(total)}
        </p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          across {active.length} active {active.length === 1 ? "category" : "categories"}.
          {mover && (
            <>
              {" "}
              <span className="text-[var(--paper)]">{mover.name}</span> is{" "}
              {mover.delta! > 0 ? "up" : "down"} {Math.abs(Math.round(mover.delta! * 100))}% on
              its 3-month average.
            </>
          )}
        </p>
      </div>

      <ul className="space-y-2.5">
        {active.map((r) => (
          <li key={r.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <CategoryIcon icon={r.icon} />
                <span className="truncate">{r.name}</span>
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <Delta value={r.delta} />
                <span className="mono tabular">{formatCurrency(r.recent)}</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
              <div
                className="h-full rounded-full bg-[var(--brass)]"
                style={{ width: `${max > 0 ? Math.max(2, (r.recent / max) * 100) : 0}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      {dormant.length > 0 && (
        <details className="border-t border-line pt-4 text-sm">
          <summary className="cursor-pointer text-[var(--muted)] transition-colors hover:text-[var(--paper)]">
            No spend in {days} days · {dormant.length}
          </summary>
          <p className="mt-2 text-[var(--muted)]">{dormant.map((r) => r.name).join(" · ")}</p>
        </details>
      )}
    </Card>
  );
}

/** "+24%" against the category's own trailing average, or nothing to compare to. */
function Delta({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-[var(--faint)]">new</span>;
  }
  // Inside ±5% of its own average is "normal" — labelling that a change is noise.
  if (Math.abs(value) < 0.05) {
    return <span className="text-xs text-[var(--faint)]">on avg</span>;
  }
  const up = value > 0;
  return (
    <span className={`text-xs tabular ${up ? "text-[var(--coral)]" : "text-[var(--jade)]"}`}>
      {up ? "+" : "−"}
      {Math.abs(Math.round(value * 100))}%
    </span>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { BudgetBar } from "@/components/budget-bar";
import { CategoryDetailPanel } from "@/components/category-detail-panel";
import { setBudget, setTagBudget } from "@/lib/actions";
import type { BudgetRow, CategoryRow } from "@/lib/queries";

export function BudgetEditor({
  rows,
  categories = [],
  kind = "category",
  emptyLabel = "No spending categories yet.",
}: {
  rows: BudgetRow[];
  categories?: CategoryRow[];
  kind?: "category" | "tag";
  emptyLabel?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] px-5">
      <ul className="divide-y divide-line/60">
        {rows.map((row) => (
          <BudgetRowItem key={row.categoryId} row={row} kind={kind} categories={categories} />
        ))}
        {rows.length === 0 && (
          <li className="py-8 text-center text-sm text-[var(--muted)]">{emptyLabel}</li>
        )}
      </ul>
    </div>
  );
}

function BudgetRowItem({
  row,
  kind,
  categories,
}: {
  row: BudgetRow;
  kind: "category" | "tag";
  categories: CategoryRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  // Tag budgets aren't categories, so there's no per-category breakdown to show.
  const expandable = kind === "category";

  return (
    <li>
      <div className="flex items-center gap-2">
        {expandable ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
            aria-expanded={expanded}
            className="shrink-0 rounded-md p-0.5 text-[var(--faint)] transition hover:text-[var(--paper)]"
          >
            <ChevronDown
              size={15}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <span className="w-[19px] shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <BudgetBar row={row} trailing={<AmountInput row={row} kind={kind} />} />
        </div>
      </div>
      {expandable && expanded && (
        <div className="-mx-5">
          <CategoryDetailPanel categoryId={row.categoryId} categories={categories} group="spending" />
        </div>
      )}
    </li>
  );
}

function AmountInput({ row, kind }: { row: BudgetRow; kind: "category" | "tag" }) {
  const router = useRouter();
  const [value, setValue] = useState(row.budget != null ? String(row.budget) : "");
  const [pending, start] = useTransition();

  function save() {
    const amount = parseFloat(value);
    const normalized = Number.isFinite(amount) && amount > 0 ? amount : 0;
    // No change?
    if ((row.budget ?? 0) === normalized) return;
    start(async () => {
      // row.categoryId carries the tag id when kind === "tag".
      if (kind === "tag") await setTagBudget(row.categoryId, normalized);
      else await setBudget(row.categoryId, normalized);
      router.refresh();
    });
  }

  return (
    <div className={`flex items-center ${pending ? "opacity-50" : ""}`}>
      <span className="mono text-sm text-[var(--muted)]">$</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="0"
        className="mono w-24 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-right text-sm outline-none focus:border-[var(--brass-dim)]"
      />
    </div>
  );
}

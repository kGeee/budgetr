"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BudgetBar } from "@/components/budget-bar";
import { setBudget, setTagBudget } from "@/lib/actions";
import type { BudgetRow } from "@/lib/queries";

export function BudgetEditor({
  rows,
  kind = "category",
  emptyLabel = "No spending categories yet.",
}: {
  rows: BudgetRow[];
  kind?: "category" | "tag";
  emptyLabel?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] px-5">
      <ul className="divide-y divide-line/60">
        {rows.map((row) => (
          <li key={row.categoryId}>
            <BudgetBar row={row} trailing={<AmountInput row={row} kind={kind} />} />
          </li>
        ))}
        {rows.length === 0 && (
          <li className="py-8 text-center text-sm text-[var(--muted)]">{emptyLabel}</li>
        )}
      </ul>
    </div>
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Repeat } from "lucide-react";
import { BudgetBar } from "@/components/budget-bar";
import { CategoryDetailPanel } from "@/components/category-detail-panel";
import { setBudget, setBudgetRollover, setTagBudget } from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type { BudgetRow, CategoryRow, EnvelopeBudgetRow } from "@/lib/queries";

// Category rows carry the envelope extras; tag rows are plain BudgetRows.
type EditorRow = BudgetRow & Partial<Omit<EnvelopeBudgetRow, keyof BudgetRow>>;

export function BudgetEditor({
  rows,
  categories = [],
  kind = "category",
  emptyLabel = "No spending categories yet.",
}: {
  rows: EditorRow[];
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
  row: EditorRow;
  kind: "category" | "tag";
  categories: CategoryRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  // Tag budgets aren't categories, so there's no per-category breakdown to show.
  const expandable = kind === "category";
  // The rollover envelope only applies to category budgets that have a limit set.
  const canRoll = kind === "category" && row.budget != null;

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
      {canRoll && <RolloverControls row={row} />}
      {expandable && expanded && (
        <div className="-mx-5">
          <CategoryDetailPanel categoryId={row.categoryId} categories={categories} group="spending" />
        </div>
      )}
    </li>
  );
}

/**
 * Per-category envelope toggle. When on, surfaces the carried-in balance and
 * the effective available (budget + carried-in − spent) beside the toggle.
 */
function RolloverControls({ row }: { row: EditorRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const enabled = row.rollover ?? false;
  const carryIn = row.carryIn ?? 0;
  const available = row.available ?? 0;

  function toggle() {
    start(async () => {
      await setBudgetRollover(row.categoryId, !enabled);
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 pb-3 pl-11 ${pending ? "opacity-50" : ""}`}>
      <button
        onClick={toggle}
        aria-pressed={enabled}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
          enabled
            ? "border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] text-[var(--brass)]"
            : "border-line text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
        }`}
      >
        <Repeat size={12} />
        Rollover {enabled ? "on" : "off"}
      </button>
      {enabled && (
        <span className="mono text-xs text-[var(--muted)]">
          <span className={carryIn < 0 ? "text-[var(--coral)]" : "text-[var(--jade)]"}>
            {carryIn >= 0 ? "+" : "−"}
            {formatCurrency(Math.abs(carryIn))}
          </span>{" "}
          carried in ·{" "}
          <span className={available < 0 ? "text-[var(--coral)]" : "text-[var(--paper)]"}>
            {formatCurrency(available)}
          </span>{" "}
          available
        </span>
      )}
    </div>
  );
}

function AmountInput({ row, kind }: { row: EditorRow; kind: "category" | "tag" }) {
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

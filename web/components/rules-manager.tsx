"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createTagRule,
  deleteTagRule,
  updateTagRule,
  type TagRuleOptions,
} from "@/lib/actions";
import type { TagRuleRow } from "@/lib/queries";

type Picker = { id: string; name: string };
type MatchType = "contains" | "exact" | "regex";

const MATCH_LABELS: Record<MatchType, string> = {
  contains: "contains",
  exact: "is exactly",
  regex: "matches regex",
};

// The editable form state, shared by the add row and the per-rule edit row.
type Draft = {
  pattern: string;
  tag: string;
  matchType: MatchType;
  minAmount: string;
  maxAmount: string;
  accountId: string;
  categoryId: string;
};

const EMPTY_DRAFT: Draft = {
  pattern: "",
  tag: "",
  matchType: "contains",
  minAmount: "",
  maxAmount: "",
  accountId: "",
  categoryId: "",
};

function draftToOptions(d: Draft): TagRuleOptions {
  const min = d.minAmount.trim() === "" ? null : Number(d.minAmount);
  const max = d.maxAmount.trim() === "" ? null : Number(d.maxAmount);
  return {
    matchType: d.matchType,
    minAmount: min != null && Number.isFinite(min) ? min : null,
    maxAmount: max != null && Number.isFinite(max) ? max : null,
    accountId: d.accountId || null,
    categoryId: d.categoryId || null,
  };
}

function fmtAmount(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function conditionSummary(r: TagRuleRow): string[] {
  const bits: string[] = [];
  if (r.minAmount != null && r.maxAmount != null)
    bits.push(`${fmtAmount(r.minAmount)}–${fmtAmount(r.maxAmount)}`);
  else if (r.minAmount != null) bits.push(`≥ ${fmtAmount(r.minAmount)}`);
  else if (r.maxAmount != null) bits.push(`≤ ${fmtAmount(r.maxAmount)}`);
  if (r.accountName) bits.push(r.accountName);
  return bits;
}

export function RulesManager({
  rules,
  accounts,
  categories,
}: {
  rules: TagRuleRow[];
  accounts: Picker[];
  categories: Picker[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  function reset() {
    setDraft(EMPTY_DRAFT);
    setAdding(false);
    setEditingId(null);
  }

  function submitAdd() {
    if (!draft.pattern.trim() || !draft.tag.trim()) {
      reset();
      return;
    }
    start(async () => {
      await createTagRule(draft.pattern, draft.tag, draftToOptions(draft));
      reset();
      router.refresh();
    });
  }

  function submitEdit(id: string) {
    if (!draft.pattern.trim() || !draft.tag.trim()) {
      reset();
      return;
    }
    start(async () => {
      await updateTagRule(id, draft.pattern, draft.tag, draftToOptions(draft));
      reset();
      router.refresh();
    });
  }

  function beginEdit(r: TagRuleRow) {
    setAdding(false);
    setEditingId(r.id);
    setDraft({
      pattern: r.label || r.pattern,
      tag: r.tagName,
      matchType: (r.matchType as MatchType) || "contains",
      minAmount: r.minAmount != null ? String(r.minAmount) : "",
      maxAmount: r.maxAmount != null ? String(r.maxAmount) : "",
      accountId: r.accountId ?? "",
      categoryId: r.categoryId ?? "",
    });
  }

  function remove(id: string) {
    start(async () => {
      await deleteTagRule(id);
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
      <ul>
        {rules.map((r) =>
          editingId === r.id ? (
            <li key={r.id} className="border-b border-line/60 last:border-0">
              <DraftForm
                draft={draft}
                setDraft={setDraft}
                accounts={accounts}
                categories={categories}
                pending={pending}
                onSubmit={() => submitEdit(r.id)}
                onCancel={reset}
                submitLabel="Save"
              />
            </li>
          ) : (
            <li
              key={r.id}
              className={`flex items-center gap-3 border-b border-line/60 px-5 py-3.5 last:border-0 ${pending ? "opacity-60" : ""}`}
            >
              <Wand2 size={15} className="shrink-0 text-[var(--brass)]" />
              <div className="min-w-0 flex-1 text-sm">
                <span className="text-[var(--muted)]">
                  {MATCH_LABELS[(r.matchType as MatchType) || "contains"]}
                </span>{" "}
                <span className={r.matchType === "regex" ? "mono font-medium" : "font-medium"}>
                  {r.label || r.pattern}
                </span>{" "}
                <span className="text-[var(--muted)]">→</span>{" "}
                <span className="rounded-full border border-line px-2 py-0.5 text-xs">
                  #{r.tagName}
                </span>
                {r.categoryName && (
                  <span className="ml-1 rounded-full border border-[var(--brass-dim)] px-2 py-0.5 text-xs text-[var(--brass)]">
                    {r.categoryName}
                  </span>
                )}
                {conditionSummary(r).length > 0 && (
                  <span className="ml-1 text-xs text-[var(--muted)]">
                    · {conditionSummary(r).join(" · ")}
                  </span>
                )}
              </div>
              <span className="mono shrink-0 text-xs text-[var(--muted)]">
                {r.matches} match{r.matches === 1 ? "" : "es"}
              </span>
              <button
                onClick={() => beginEdit(r)}
                aria-label="Edit rule"
                className="shrink-0 rounded-md p-1.5 text-[var(--faint)] transition hover:text-[var(--paper)]"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => remove(r.id)}
                aria-label="Delete rule"
                className="shrink-0 rounded-md p-1.5 text-[var(--faint)] transition hover:text-[var(--coral)]"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ),
        )}
        {rules.length === 0 && !adding && (
          <li className="px-5 py-6 text-sm text-[var(--muted)]">
            No rules yet. Tag a transaction and choose “always tag this vendor”, or add one below.
          </li>
        )}
      </ul>

      {adding ? (
        <div className="border-t border-line">
          <DraftForm
            draft={draft}
            setDraft={setDraft}
            accounts={accounts}
            categories={categories}
            pending={pending}
            onSubmit={submitAdd}
            onCancel={reset}
            submitLabel="Add"
          />
        </div>
      ) : (
        <button
          onClick={() => {
            setEditingId(null);
            setDraft(EMPTY_DRAFT);
            setAdding(true);
          }}
          className="flex w-full items-center gap-2 border-t border-line px-5 py-3.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
        >
          <Plus size={15} /> Add rule
        </button>
      )}
    </div>
  );
}

const SELECT_CLS =
  "rounded-md border border-line bg-[var(--ink)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]";
const INPUT_CLS =
  "rounded-md border border-line bg-[var(--ink)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]";

function DraftForm({
  draft,
  setDraft,
  accounts,
  categories,
  pending,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  accounts: Picker[];
  categories: Picker[];
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <div className={`space-y-3 px-5 py-4 ${pending ? "opacity-60" : ""}`}>
      {/* Match line */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-[var(--muted)]">When name</span>
        <select
          value={draft.matchType}
          onChange={(e) => set({ matchType: e.target.value as MatchType })}
          className={SELECT_CLS}
        >
          <option value="contains">contains</option>
          <option value="exact">is exactly</option>
          <option value="regex">matches regex</option>
        </select>
        <input
          autoFocus
          value={draft.pattern}
          onChange={(e) => set({ pattern: e.target.value })}
          placeholder={draft.matchType === "regex" ? "^uber\\b" : "e.g. uber"}
          className={`w-40 ${INPUT_CLS} ${draft.matchType === "regex" ? "mono" : ""}`}
        />
        <span className="text-sm text-[var(--muted)]">tag it</span>
        <input
          value={draft.tag}
          onChange={(e) => set({ tag: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="rideshare"
          className={`w-32 ${INPUT_CLS}`}
        />
      </div>

      {/* Conditions line */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-[var(--faint)]">only if</span>
        <input
          type="number"
          step="any"
          value={draft.minAmount}
          onChange={(e) => set({ minAmount: e.target.value })}
          placeholder="min $"
          className={`w-24 ${INPUT_CLS}`}
        />
        <span className="text-sm text-[var(--muted)]">–</span>
        <input
          type="number"
          step="any"
          value={draft.maxAmount}
          onChange={(e) => set({ maxAmount: e.target.value })}
          placeholder="max $"
          className={`w-24 ${INPUT_CLS}`}
        />
        <select
          value={draft.accountId}
          onChange={(e) => set({ accountId: e.target.value })}
          className={SELECT_CLS}
        >
          <option value="">any account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="text-xs uppercase tracking-wide text-[var(--faint)]">also set</span>
        <select
          value={draft.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
          className={SELECT_CLS}
        >
          <option value="">no category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onSubmit} disabled={pending}>
          <Check size={14} /> {submitLabel}
        </Button>
        <button
          onClick={onCancel}
          aria-label="Cancel"
          className="rounded-md p-1.5 text-[var(--faint)] hover:text-[var(--paper)]"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Mark, Verdict } from "@/components/ui/statement";
import {
  createTagRule,
  deleteTagRule,
  updateTagRule,
  type TagRuleOptions,
} from "@/lib/actions";
import { CategoryDot } from "@/components/transactions/ledger-bits";
import type { TagRuleRow } from "@/lib/queries";

type Picker = { id: string; name: string; color?: string | null };
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

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const countWord = (n: number) => COUNT_WORDS[n] ?? n.toLocaleString();
const matchCount = (n: number) => `${n.toLocaleString()} ${n === 1 ? "match" : "matches"}`;

// One column per part of a rule; the header and every row share the template.
const GRID =
  "grid grid-cols-[120px_minmax(160px,1.3fr)_minmax(110px,0.8fr)_minmax(130px,1fr)_minmax(130px,1fr)_84px_96px] items-center gap-4";
const ICON_BTN =
  "grid h-11 w-11 place-items-center rounded-full text-[var(--muted)] transition disabled:opacity-50";

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

  const totalMatches = rules.reduce((sum, r) => sum + r.matches, 0);
  const editing = rules.find((r) => r.id === editingId) ?? null;
  const colorOf = (id: string | null) =>
    (id && categories.find((c) => c.id === id)?.color) || null;

  const form = (kind: "add" | "edit") => (
    <DraftForm
      title={kind === "add" ? "New rule" : `Editing · ${editing?.label || editing?.pattern || ""}`}
      note={kind === "edit" && editing ? matchCount(editing.matches) : undefined}
      draft={draft}
      setDraft={setDraft}
      accounts={accounts}
      categories={categories}
      pending={pending}
      onSubmit={kind === "add" ? submitAdd : () => editing && submitEdit(editing.id)}
      onCancel={reset}
      submitLabel={kind === "add" ? "Add rule" : "Save"}
    />
  );

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div className="flex max-w-[640px] flex-col gap-2">
          <Verdict>
            {rules.length === 0 ? (
              "No rules yet. Nothing is tagged as it arrives."
            ) : (
              <>
                {countWord(rules.length)} {rules.length === 1 ? "rule reads" : "rules read"} each
                transaction’s name as it arrives, with{" "}
                <Mark tone={totalMatches > 0 ? "jade" : "muted"}>{matchCount(totalMatches)}</Mark>{" "}
                between them so far.
              </>
            )}
          </Verdict>
          <p className="text-[13px] text-[var(--muted)]">
            A rule always adds a tag. It can also set a category, and can be narrowed by amount or
            account.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setDraft(EMPTY_DRAFT);
            setAdding(true);
          }}
          disabled={adding}
          className="inline-flex min-h-11 items-center rounded-full bg-[var(--jade)] px-4.5 text-sm font-semibold text-[var(--on-jade)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-45"
        >
          Add rule
        </button>
      </div>

      <section aria-label="Rules">
        {/* A container, so the in-place form can match the visible width (and
            stay put) when the table itself is scrolled sideways on a phone. */}
        <div className="@container overflow-x-auto">
          <div role="table" aria-label="Auto-tag rules" className="min-w-[820px]">
            <div
              role="row"
              className={`${GRID} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
            >
              <span role="columnheader">When name</span>
              <span role="columnheader">Pattern</span>
              <span role="columnheader">Add tag</span>
              <span role="columnheader">Set category</span>
              <span role="columnheader">Only if</span>
              <span role="columnheader" className="text-right">
                Matches
              </span>
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            </div>

            {rules.map((r) => {
              const isEditing = editingId === r.id;
              const conditions = conditionSummary(r);
              return (
                <div key={r.id}>
                  <div
                    role="row"
                    aria-current={isEditing ? "true" : undefined}
                    className={`${GRID} min-h-14 text-sm ${
                      isEditing ? "border-b border-[var(--line-strong)]" : "border-b border-line"
                    } ${pending ? "opacity-60" : ""}`}
                  >
                    <span role="cell" className="text-[var(--muted)]">
                      {MATCH_LABELS[(r.matchType as MatchType) || "contains"]}
                    </span>
                    <span role="cell" className="mono truncate" title={r.label || r.pattern}>
                      {r.label || r.pattern}
                    </span>
                    <span role="cell" className="mono truncate text-[13px] text-[var(--brass)]">
                      {r.tagName}
                    </span>
                    <span role="cell" className="flex min-w-0 items-center gap-2">
                      {r.categoryName ? (
                        <>
                          <CategoryDot id={r.categoryId} color={colorOf(r.categoryId)} />
                          <span className="truncate">{r.categoryName}</span>
                        </>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </span>
                    <span role="cell" className="truncate text-[13px] text-[var(--muted)]">
                      {conditions.length > 0 ? conditions.join(" · ") : "—"}
                    </span>
                    <span role="cell" className="mono text-right">
                      {matchCount(r.matches)}
                    </span>
                    <span role="cell" className="flex justify-end">
                      <button
                        onClick={() => (isEditing ? reset() : beginEdit(r))}
                        aria-label={`Edit the ${r.label || r.pattern} rule`}
                        aria-expanded={isEditing}
                        className={`${ICON_BTN} hover:text-[var(--paper)] ${isEditing ? "text-[var(--paper)]" : ""}`}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => remove(r.id)}
                        disabled={pending}
                        aria-label={`Delete the ${r.label || r.pattern} rule`}
                        className={`${ICON_BTN} hover:text-[var(--coral)]`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </div>
                  {/* The form opens in place, hanging off the row it edits. */}
                  {isEditing && form("edit")}
                </div>
              );
            })}
          </div>
        </div>

        {adding && form("add")}

        <p className="mt-4 text-[13px] text-[var(--muted)]">
          Rules also start from a transaction: tag it and choose “always tag this vendor”. Adding a
          rule opens the same form as editing.
        </p>
      </section>
    </div>
  );
}

const FIELD_CLS =
  "min-h-11 min-w-0 rounded-xl border border-line bg-[var(--ink)] px-3 text-sm text-[var(--paper)] outline-none transition-colors focus:border-[var(--brass-dim)]";

function DraftForm({
  title,
  note,
  draft,
  setDraft,
  accounts,
  categories,
  pending,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  title: string;
  note?: string;
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
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onSubmit();
    if (e.key === "Escape") onCancel();
  };

  return (
    <div
      role="group"
      aria-label={title}
      className={`sticky left-0 box-border flex w-full max-w-[100cqw] flex-col gap-3.5 rounded-b-[var(--radius)] border border-t-0 border-[var(--line-strong)] bg-[var(--panel)] px-5 pb-5 pt-4 ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow truncate">{title}</span>
        {note && <span className="mono shrink-0 text-xs text-[var(--muted)]">{note}</span>}
      </div>

      {/* Match line */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="contents">
          <span className="text-[var(--muted)]">When name</span>
          <select
            value={draft.matchType}
            onChange={(e) => set({ matchType: e.target.value as MatchType })}
            className={FIELD_CLS}
          >
            <option value="contains">contains</option>
            <option value="exact">is exactly</option>
            <option value="regex">matches regex</option>
          </select>
        </label>
        <input
          autoFocus
          value={draft.pattern}
          onChange={(e) => set({ pattern: e.target.value })}
          onKeyDown={onKey}
          placeholder={draft.matchType === "regex" ? "^uber\\b" : "e.g. uber"}
          aria-label="Pattern"
          className={`${FIELD_CLS} mono flex-[1_1_180px] border-[var(--line-strong)]`}
        />
        <label className="contents">
          <span className="text-[var(--muted)]">tag it</span>
          <input
            value={draft.tag}
            onChange={(e) => set({ tag: e.target.value })}
            onKeyDown={onKey}
            placeholder="rideshare"
            className={`${FIELD_CLS} mono flex-[1_1_140px] text-[var(--brass)]`}
          />
        </label>
      </div>

      {/* Conditions line */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[var(--muted)]">Only if</span>
        <input
          type="number"
          step="any"
          value={draft.minAmount}
          onChange={(e) => set({ minAmount: e.target.value })}
          onKeyDown={onKey}
          placeholder="min $"
          aria-label="Minimum amount"
          className={`${FIELD_CLS} mono w-24`}
        />
        <input
          type="number"
          step="any"
          value={draft.maxAmount}
          onChange={(e) => set({ maxAmount: e.target.value })}
          onKeyDown={onKey}
          placeholder="max $"
          aria-label="Maximum amount"
          className={`${FIELD_CLS} mono w-24`}
        />
        <select
          value={draft.accountId}
          onChange={(e) => set({ accountId: e.target.value })}
          aria-label="Account"
          className={`${FIELD_CLS} flex-[1_1_150px]`}
        >
          <option value="">any account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="text-[var(--muted)]">and set</span>
        <select
          value={draft.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
          aria-label="Category"
          className={`${FIELD_CLS} flex-[1_1_150px]`}
        >
          <option value="">no category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button
          onClick={onSubmit}
          disabled={pending}
          className="inline-flex min-h-11 items-center rounded-full bg-[var(--jade)] px-5 text-sm font-semibold text-[var(--on-jade)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
        >
          {submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-[var(--muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

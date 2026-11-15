"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2, X } from "lucide-react";
import { deleteFilter, saveFilter } from "@/lib/actions";
import { setCountPending } from "@/lib/actions-settings";
import type { CategoryRow, TxTag, TxnCriteria } from "@/lib/queries";
import type { SavedFilter } from "@/db/schema";

type AccountOption = { id: string; name: string };

/** Build the `/transactions` querystring for a set of criteria. */
function toParams(c: TxnCriteria): URLSearchParams {
  const p = new URLSearchParams();
  if (c.q) p.set("q", c.q);
  if (c.accountId) p.set("account", c.accountId);
  if (c.categoryId) p.set("category", c.categoryId);
  if (c.tagId) p.set("tag", c.tagId);
  if (c.dateFrom) p.set("from", c.dateFrom);
  if (c.dateTo) p.set("to", c.dateTo);
  if (c.amountMin != null) p.set("min", String(c.amountMin));
  if (c.amountMax != null) p.set("max", String(c.amountMax));
  if (c.reviewed != null) p.set("reviewed", c.reviewed ? "yes" : "no");
  return p;
}

const FIELD =
  "min-h-11 min-w-0 rounded-xl border border-line bg-[var(--ink)] px-3 text-sm text-[var(--paper)] outline-none transition-colors focus:border-[var(--brass-dim)]";
const MONO_FIELD = `${FIELD} mono text-xs`;
const PILL =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm transition active:scale-[0.98] disabled:opacity-45";
const PILL_STRONG = `${PILL} border border-[var(--line-strong)] text-[var(--paper)] hover:bg-[var(--panel-2)]`;

const reviewedValue = (r: boolean | undefined) => (r == null ? "" : r ? "yes" : "no");

export function TransactionsFilterBar({
  criteria,
  categories,
  accounts,
  tags,
  savedFilters,
  countPending,
}: {
  criteria: TxnCriteria;
  categories: CategoryRow[];
  accounts: AccountOption[];
  tags: TxTag[];
  savedFilters: SavedFilter[];
  /** The app-wide "count pending as spending" preference, when it's shown here. */
  countPending?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [q, setQ] = useState(criteria.q ?? "");
  const [accountId, setAccountId] = useState(criteria.accountId ?? "");
  const [categoryId, setCategoryId] = useState(criteria.categoryId ?? "");
  const [tagId, setTagId] = useState(criteria.tagId ?? "");
  const [dateFrom, setDateFrom] = useState(criteria.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(criteria.dateTo ?? "");
  const [amountMin, setAmountMin] = useState(
    criteria.amountMin != null ? String(criteria.amountMin) : "",
  );
  const [amountMax, setAmountMax] = useState(
    criteria.amountMax != null ? String(criteria.amountMax) : "",
  );

  const [reviewed, setReviewedFilter] = useState(reviewedValue(criteria.reviewed));

  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterName, setFilterName] = useState("");

  const hasActive =
    !!q ||
    !!accountId ||
    !!categoryId ||
    !!tagId ||
    !!dateFrom ||
    !!dateTo ||
    !!amountMin ||
    !!amountMax ||
    !!reviewed;

  function buildCriteria(): TxnCriteria {
    const c: TxnCriteria = {};
    if (q.trim()) c.q = q.trim();
    if (accountId) c.accountId = accountId;
    if (categoryId) c.categoryId = categoryId;
    if (tagId) c.tagId = tagId;
    if (dateFrom) c.dateFrom = dateFrom;
    if (dateTo) c.dateTo = dateTo;
    const min = parseFloat(amountMin);
    if (!Number.isNaN(min)) c.amountMin = min;
    const max = parseFloat(amountMax);
    if (!Number.isNaN(max)) c.amountMax = max;
    if (reviewed) c.reviewed = reviewed === "yes";
    return c;
  }

  function navigate(c: TxnCriteria) {
    const qs = toParams(c).toString();
    router.push(qs ? `/transactions?${qs}` : "/transactions");
  }

  function apply() {
    navigate(buildCriteria());
  }

  function clearAll() {
    setQ("");
    setAccountId("");
    setCategoryId("");
    setTagId("");
    setDateFrom("");
    setDateTo("");
    setAmountMin("");
    setAmountMax("");
    setReviewedFilter("");
    router.push("/transactions");
  }

  function applySaved(f: SavedFilter) {
    let c: TxnCriteria = {};
    try {
      c = JSON.parse(f.query) as TxnCriteria;
    } catch {
      c = {};
    }
    setQ(c.q ?? "");
    setAccountId(c.accountId ?? "");
    setCategoryId(c.categoryId ?? "");
    setTagId(c.tagId ?? "");
    setDateFrom(c.dateFrom ?? "");
    setDateTo(c.dateTo ?? "");
    setAmountMin(c.amountMin != null ? String(c.amountMin) : "");
    setAmountMax(c.amountMax != null ? String(c.amountMax) : "");
    setReviewedFilter(reviewedValue(c.reviewed));
    setMenuOpen(false);
    navigate(c);
  }

  function saveCurrent() {
    const name = filterName.trim();
    if (!name) return;
    start(async () => {
      await saveFilter(name, buildCriteria());
      setFilterName("");
      setSaving(false);
      router.refresh();
    });
  }

  function togglePending() {
    start(async () => {
      await setCountPending(!countPending);
      router.refresh();
    });
  }

  function removeSaved(id: string) {
    start(async () => {
      await deleteFilter(id);
      router.refresh();
    });
  }

  const onEnter = (e: React.KeyboardEvent) => e.key === "Enter" && apply();

  return (
    <section aria-label="Filters" className="flex flex-col gap-2.5">
      {/* Row 1 — free text and the four things a row can be narrowed by */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onEnter}
          placeholder="Search name, merchant, or notes…"
          className={`${FIELD} flex-[2_1_240px] bg-[var(--panel)] px-3.5`}
          aria-label="Search transactions"
        />

        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className={`${FIELD} flex-[1_1_130px]`}
          aria-label="Account"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={`${FIELD} flex-[1_1_130px]`}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          className={`${FIELD} flex-[1_1_110px]`}
          aria-label="Tag"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name}
            </option>
          ))}
        </select>

        <select
          value={reviewed}
          onChange={(e) => setReviewedFilter(e.target.value)}
          className={`${FIELD} flex-[1_1_130px]`}
          aria-label="Review status"
        >
          <option value="">Any status</option>
          <option value="no">Not reviewed</option>
          <option value="yes">Reviewed</option>
        </select>
      </div>

      {/* Row 2 — range, the pending preference, saved filters, apply */}
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--muted)]">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          onKeyDown={onEnter}
          className={MONO_FIELD}
          aria-label="From date"
        />
        <span>to</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          onKeyDown={onEnter}
          className={MONO_FIELD}
          aria-label="To date"
        />
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={amountMin}
          onChange={(e) => setAmountMin(e.target.value)}
          onKeyDown={onEnter}
          placeholder="Min $"
          className={`${MONO_FIELD} w-[84px]`}
          aria-label="Minimum amount"
        />
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={amountMax}
          onChange={(e) => setAmountMax(e.target.value)}
          onKeyDown={onEnter}
          placeholder="Max $"
          className={`${MONO_FIELD} w-[84px]`}
          aria-label="Maximum amount"
        />

        {countPending != null && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1.5">
            <input
              type="checkbox"
              checked={countPending}
              disabled={pending}
              onChange={togglePending}
              className="h-4 w-4 cursor-pointer accent-[var(--jade)]"
            />
            Count pending as spending
          </label>
        )}

        <span className="grow" />

        <div className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            className={`${PILL} border border-line text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]`}
          >
            Saved filters
            {savedFilters.length > 0 && <span className="mono text-xs">{savedFilters.length}</span>}
          </button>

          {menuOpen && (
            <>
              <button
                className="fixed inset-0 z-10 cursor-default"
                aria-hidden
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel-2)] shadow-[var(--elev-2)]">
                <div className="max-h-64 overflow-y-auto">
                  {savedFilters.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-[var(--muted)]">
                      No saved filters yet. Set some criteria, then save them here.
                    </p>
                  ) : (
                    <ul>
                      {savedFilters.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-0"
                        >
                          <button
                            onClick={() => applySaved(f)}
                            className="min-w-0 flex-1 truncate text-left text-sm text-[var(--paper)] transition-colors hover:text-[var(--brass)]"
                          >
                            {f.name}
                          </button>
                          <button
                            onClick={() => removeSaved(f.id)}
                            disabled={pending}
                            aria-label={`Delete ${f.name}`}
                            className="shrink-0 rounded-md p-1 text-[var(--muted)] transition hover:text-[var(--coral)]"
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {saving ? (
          <span className="flex items-center gap-1.5">
            <input
              autoFocus
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveCurrent();
                if (e.key === "Escape") setSaving(false);
              }}
              placeholder="Filter name"
              aria-label="Filter name"
              className={`${FIELD} w-40`}
            />
            <button onClick={saveCurrent} disabled={pending} className={PILL_STRONG}>
              <Check size={14} /> Save
            </button>
            <button
              onClick={() => setSaving(false)}
              aria-label="Cancel"
              className="grid h-11 w-9 place-items-center rounded-full text-[var(--muted)] hover:text-[var(--paper)]"
            >
              <X size={16} />
            </button>
          </span>
        ) : (
          <button onClick={() => setSaving(true)} disabled={!hasActive} className={PILL_STRONG}>
            Save filter
          </button>
        )}

        {hasActive && (
          <button
            onClick={clearAll}
            className={`${PILL} px-2 text-[var(--muted)] hover:text-[var(--paper)]`}
          >
            <X size={14} /> Clear
          </button>
        )}
        <button
          onClick={apply}
          className={`${PILL} bg-[var(--jade)] font-semibold text-[var(--on-jade)] hover:brightness-105`}
        >
          Apply
        </button>
      </div>
    </section>
  );
}

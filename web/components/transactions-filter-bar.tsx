"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Check, Filter, Save, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteFilter, saveFilter } from "@/lib/actions";
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
  return p;
}

const inputCls =
  "rounded-md border border-line bg-[var(--ink)] px-2.5 py-1.5 text-sm text-[var(--paper)] outline-none transition-colors focus:border-[var(--brass-dim)]";

export function TransactionsFilterBar({
  criteria,
  categories,
  accounts,
  tags,
  savedFilters,
  resultCount,
}: {
  criteria: TxnCriteria;
  categories: CategoryRow[];
  accounts: AccountOption[];
  tags: TxTag[];
  savedFilters: SavedFilter[];
  resultCount: number;
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
    !!amountMax;

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

  function removeSaved(id: string) {
    start(async () => {
      await deleteFilter(id);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-4">
      {/* Row 1 — free text + saved-filter menu */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)]"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply()}
            placeholder="Search name, merchant, or notes…"
            className={`${inputCls} w-full pl-9`}
            aria-label="Search transactions"
          />
        </div>

        <div className="relative">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            <Bookmark size={14} /> Saved
            {savedFilters.length > 0 && (
              <span className="mono text-xs text-[var(--muted)]">{savedFilters.length}</span>
            )}
          </Button>

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
                          className="flex items-center gap-2 border-b border-line/60 px-3 py-2 last:border-0"
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
                            className="shrink-0 rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--coral)]"
                          >
                            <Trash2 size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="border-t border-line p-2">
                  {saving ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={filterName}
                        onChange={(e) => setFilterName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
                        placeholder="Filter name"
                        className={`${inputCls} min-w-0 flex-1`}
                      />
                      <Button size="sm" onClick={saveCurrent} disabled={pending}>
                        <Check size={14} /> Save
                      </Button>
                      <button
                        onClick={() => setSaving(false)}
                        aria-label="Cancel"
                        className="rounded-md p-1.5 text-[var(--faint)] hover:text-[var(--paper)]"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setSaving(true)}
                      disabled={!hasActive}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--panel)] hover:text-[var(--paper)] disabled:opacity-45 disabled:hover:bg-transparent"
                    >
                      <Save size={14} /> Save current filter
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Row 2 — structured controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={inputCls}
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
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className={inputCls}
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
          value={tagId}
          onChange={(e) => setTagId(e.target.value)}
          className={inputCls}
          aria-label="Tag"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              #{t.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={inputCls}
            aria-label="From date"
          />
          <span className="text-sm text-[var(--faint)]">→</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={inputCls}
            aria-label="To date"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
            placeholder="Min $"
            className={`${inputCls} w-24`}
            aria-label="Minimum amount"
          />
          <span className="text-sm text-[var(--faint)]">–</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
            placeholder="Max $"
            className={`${inputCls} w-24`}
            aria-label="Maximum amount"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {hasActive && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
            >
              <X size={14} /> Clear
            </button>
          )}
          <Button size="sm" onClick={apply}>
            <Filter size={14} /> Apply
          </Button>
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--muted)]">
        {resultCount} {resultCount === 1 ? "result" : "results"}
        {hasActive && " for current filter"}
      </p>
    </div>
  );
}

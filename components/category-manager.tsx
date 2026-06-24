"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowUpRight, Check, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { CategoryIcon } from "@/components/category-pill";
import { Button } from "@/components/ui/button";
import {
  archiveCategory,
  createCategory,
  renameCategory,
  unarchiveCategory,
} from "@/lib/actions";
import { formatCurrency } from "@/lib/utils";
import type { CategoryRow } from "@/lib/queries";

const GROUP_ORDER = ["income", "spending", "transfer"] as const;
const GROUP_LABEL: Record<string, string> = {
  income: "Income",
  spending: "Spending",
  transfer: "Transfers",
};

export function CategoryManager({
  categories,
  archived = [],
}: {
  categories: CategoryRow[];
  archived?: CategoryRow[];
}) {
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    rows: categories.filter((c) => c.group === g),
  })).filter((s) => s.rows.length > 0 || s.group === "spending");

  return (
    <div className="space-y-8">
      {grouped.map(({ group, rows }) => (
        <section key={group}>
          <p className="eyebrow mb-3">{GROUP_LABEL[group]}</p>
          <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
            <ul>
              {rows.map((c) => (
                <Row key={c.id} category={c} />
              ))}
              {rows.length === 0 && (
                <li className="px-5 py-4 text-sm text-[var(--muted)]">No categories yet.</li>
              )}
            </ul>
            {group === "spending" && <AddCategory />}
          </div>
        </section>
      ))}

      {archived.length > 0 && <ArchivedSection rows={archived} />}
    </div>
  );
}

function ArchivedSection({ rows }: { rows: CategoryRow[] }) {
  return (
    <section>
      <p className="eyebrow mb-3 text-[var(--faint)]">Archived</p>
      <div className="overflow-hidden rounded-[var(--radius)] border border-dashed border-line bg-[var(--panel)]">
        <ul>
          {rows.map((c) => (
            <ArchivedRow key={c.id} category={c} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function ArchivedRow({ category }: { category: CategoryRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function restore() {
    start(async () => {
      await unarchiveCategory(category.id);
      router.refresh();
    });
  }

  return (
    <li
      className={`group flex items-center gap-3 border-b border-line/60 px-5 py-3.5 last:border-0 ${
        pending ? "opacity-50" : ""
      }`}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--faint)]">
        <CategoryIcon icon={category.icon} size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">{category.name}</span>
      <Button size="sm" variant="ghost" onClick={restore} disabled={pending}>
        <RotateCcw size={13} /> Restore
      </Button>
    </li>
  );
}

function Row({ category }: { category: CategoryRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [pending, start] = useTransition();

  function save() {
    const next = name.trim();
    setEditing(false);
    if (!next || next === category.name) {
      setName(category.name);
      return;
    }
    start(async () => {
      await renameCategory(category.id, next);
      router.refresh();
    });
  }

  function archive() {
    if (!confirm(`Archive "${category.name}"? Its transactions stay put — you can restore it anytime from the Archived section.`)) {
      return;
    }
    start(async () => {
      await archiveCategory(category.id);
      router.refresh();
    });
  }

  return (
    <li
      className={`group flex items-center gap-3 border-b border-line/60 px-5 py-3.5 last:border-0 transition-colors hover:bg-[var(--panel-2)] ${
        pending ? "opacity-50" : ""
      }`}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)] text-[var(--brass)]">
        <CategoryIcon icon={category.icon} size={15} />
      </span>

      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setName(category.name);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-line bg-[var(--ink)] px-2 py-1 text-sm outline-none focus:border-[var(--brass-dim)]"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium"
        >
          <span className="truncate">{category.name}</span>
          <Pencil
            size={12}
            className="shrink-0 text-[var(--faint)] opacity-0 transition-opacity group-hover:opacity-100"
          />
        </button>
      )}

      {category.spend30 > 0 && (
        <span className="mono shrink-0 text-xs text-[var(--muted)]">
          {formatCurrency(category.spend30)}
          <span className="ml-1 text-[var(--faint)]">· 30d</span>
        </span>
      )}

      <Link
        href={`/categories/${category.id}`}
        aria-label={`View ${category.name} transactions`}
        className="shrink-0 rounded-md p-1.5 text-[var(--faint)] opacity-0 transition hover:text-[var(--brass)] group-hover:opacity-100"
      >
        <ArrowUpRight size={15} />
      </Link>

      <button
        onClick={archive}
        aria-label={`Archive ${category.name}`}
        className="shrink-0 rounded-md p-1.5 text-[var(--faint)] opacity-0 transition hover:text-[var(--coral)] group-hover:opacity-100"
      >
        <Archive size={14} />
      </button>
    </li>
  );
}

function AddCategory() {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    const next = name.trim();
    if (!next) {
      setAdding(false);
      return;
    }
    start(async () => {
      await createCategory(next, "spending");
      setName("");
      setAdding(false);
      router.refresh();
    });
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="flex w-full items-center gap-2 px-5 py-3.5 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
      >
        <Plus size={15} />
        Add category
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-2 px-5 py-3 ${pending ? "opacity-50" : ""}`}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setName("");
            setAdding(false);
          }
        }}
        placeholder="Category name"
        className="min-w-0 flex-1 rounded-md border border-line bg-[var(--ink)] px-2 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
      />
      <Button size="sm" variant="primary" onClick={submit} disabled={pending}>
        <Check size={14} /> Add
      </Button>
      <button
        onClick={() => {
          setName("");
          setAdding(false);
        }}
        aria-label="Cancel"
        className="rounded-md p-1.5 text-[var(--faint)] hover:text-[var(--paper)]"
      >
        <X size={16} />
      </button>
    </div>
  );
}

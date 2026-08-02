"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  Receipt,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import {
  confirmSettlementSuggestion,
  createPerson,
  dismissSettlementSuggestion,
  recordSettlement,
  removeSettlement,
  updatePerson,
} from "@/lib/actions-sharing";
import type {
  PersonBalance,
  SettlementRow,
  SettlementSuggestion,
  SharedExpenseRow,
} from "@/lib/sharing";

/**
 * The Shared page body — the repayment inbox, a balance card per person, and one
 * activity ledger underneath.
 *
 * Navigation hinges on *focus*: selecting a person filters the ledger to just
 * them, so "what's the story with Sam" is one click rather than two lists read
 * side by side. Focus lives in client state (instant, no server round-trip) and
 * is mirrored into `?p=` so the view survives a reload and can be linked.
 */
export function SharedView({
  people,
  expenses,
  settlements,
  suggestions,
}: {
  people: PersonBalance[];
  expenses: SharedExpenseRow[];
  settlements: SettlementRow[];
  suggestions: SettlementSuggestion[];
}) {
  // Seeded from the querystring (so a linked/reloaded view lands focused) but
  // owned by React from then on — the URL is written back imperatively below.
  const searchParams = useSearchParams();
  const [focus, setFocusState] = useState<string | null>(() => searchParams.get("p"));
  const [showArchived, setShowArchived] = useState(false);

  function setFocus(id: string | null) {
    setFocusState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("p", id);
    else url.searchParams.delete("p");
    // Native history update — Next.js keeps this out of the RSC round-trip, so
    // focusing a person stays instant.
    window.history.replaceState(null, "", url);
  }

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const focused = focus ? (byId.get(focus) ?? null) : null;

  const visible = people.filter((p) => !p.archived || Math.abs(p.balance) > 0.01);
  const owesYou = visible.filter((p) => p.balance > 0.01).sort((a, b) => b.balance - a.balance);
  const youOwe = visible.filter((p) => p.balance < -0.01).sort((a, b) => a.balance - b.balance);
  const square = visible.filter((p) => Math.abs(p.balance) <= 0.01);
  const archived = people.filter((p) => p.archived && Math.abs(p.balance) <= 0.01);
  const live = [...owesYou, ...youOwe];

  return (
    <div className="space-y-7">
      {suggestions.length > 0 && <SuggestionInbox suggestions={suggestions} />}

      <section aria-labelledby="people-heading">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <h2 id="people-heading" className="eyebrow">
              People
            </h2>
            {visible.length > 0 && (
              <span className="text-xs text-[var(--faint)]">{visible.length}</span>
            )}
          </div>
          <AddPerson />
        </div>

        {live.length === 0 && square.length === 0 ? (
          <EmptyState
            icon={<Users size={18} aria-hidden />}
            title="No one here yet"
            body="Add someone above, or split a transaction from its detail panel and add them inline."
          />
        ) : (
          <div className="space-y-4">
            {live.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {live.map((p, i) => (
                  <PersonCard
                    key={p.id}
                    person={p}
                    index={i}
                    focused={focus === p.id}
                    onFocus={() => setFocus(focus === p.id ? null : p.id)}
                  />
                ))}
              </div>
            )}

            {/* Settled people are still worth seeing — just not at card weight. */}
            {square.length > 0 && (
              <SquareStrip
                people={square}
                focus={focus}
                onFocus={(id) => setFocus(focus === id ? null : id)}
              />
            )}
          </div>
        )}

        {archived.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[var(--faint)] transition-colors duration-200 hover:text-[var(--muted)]"
            >
              <ChevronDown
                size={13}
                aria-hidden
                className={`transition-transform duration-200 ${showArchived ? "rotate-180" : ""}`}
              />
              Archived · {archived.length}
            </button>
            {showArchived && (
              <SquareStrip
                className="mt-3"
                people={archived}
                focus={focus}
                onFocus={(id) => setFocus(focus === id ? null : id)}
              />
            )}
          </div>
        )}
      </section>

      <Ledger
        expenses={expenses}
        settlements={settlements}
        focused={focused}
        onClearFocus={() => setFocus(null)}
      />
    </div>
  );
}

// ── Identity ─────────────────────────────────────────────────────────────────

/**
 * A fixed hue ring, spaced far enough apart that adjacent people never read as
 * the same colour. Lightness and saturation come from the theme (`.tint`), so
 * one hue works on both the dark canvas and the light one.
 */
const HUES = [152, 40, 208, 12, 268, 96, 330, 186];

/** Stable hue per person — the same face colour follows them across the page. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (parts[0][0] + last).toUpperCase();
}

const AVATAR_SIZE = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-10 w-10 text-xs",
} as const;

/** Tinted initials disc. Decorative — the name is always adjacent in the DOM. */
function Avatar({
  person,
  size = "md",
  className = "",
}: {
  person: { id: string; name: string };
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      title={person.name}
      style={{ "--tint-h": hueFor(person.id) } as React.CSSProperties}
      className={cn(
        "tint grid shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--tint)_38%,transparent)] bg-[color-mix(in_srgb,var(--tint)_15%,transparent)] font-medium text-[var(--tint)]",
        AVATAR_SIZE[size],
        className,
      )}
    >
      {initials(person.name)}
    </span>
  );
}

/**
 * Overlapping avatars for the people on one split. Hidden on narrow screens —
 * the row needs that width for the merchant name, and the names are spelled out
 * in the line beneath it anyway.
 */
function AvatarStack({ people: p }: { people: { personId: string; personName: string }[] }) {
  const shown = p.slice(0, 3);
  return (
    <span className="hidden shrink-0 -space-x-2 sm:flex">
      {shown.map((s) => (
        <Avatar
          key={s.personId}
          person={{ id: s.personId, name: s.personName }}
          size="sm"
          className="ring-2 ring-[var(--panel)]"
        />
      ))}
      {p.length > shown.length && (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-[var(--panel-2)] text-[10px] text-[var(--muted)] ring-2 ring-[var(--panel)]">
          +{p.length - shown.length}
        </span>
      )}
    </span>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-line px-6 py-10 text-center">
      <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full border border-line bg-[var(--panel)] text-[var(--faint)]">
        {icon}
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--muted)]">{body}</p>
    </div>
  );
}

/**
 * Suggested repayments awaiting a yes/no. Mirrors the refund/transfer match
 * inbox: confirm records the settlement and files the inflow as reimbursable,
 * dismiss tombstones it so it never comes back.
 */
function SuggestionInbox({ suggestions }: { suggestions: SettlementSuggestion[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function act(txnId: string, fn: () => Promise<unknown>) {
    setBusy(txnId);
    start(async () => {
      await fn();
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <Card
      id="confirm"
      className="rise scroll-mt-24 border-[var(--brass-dim)] shadow-[var(--elev-3)]"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles size={13} aria-hidden className="text-[var(--brass)]" /> Repayments to confirm
        </CardTitle>
        <span className="mono text-xs text-[var(--muted)]">{suggestions.length}</span>
      </CardHeader>

      <ul className="space-y-2">
        {suggestions.map((s) => {
          const working = pending && busy === s.txnId;
          return (
            <li
              key={s.txnId}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-line bg-[color-mix(in_srgb,var(--ink)_40%,transparent)] px-3.5 py-3 transition-colors duration-200 hover:border-[var(--line-strong)]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar person={{ id: s.personId, name: s.personName }} />
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    <span className="mono tabular text-[var(--jade)]">
                      {formatCurrency(s.amount, s.currency ?? undefined)}
                    </span>{" "}
                    from {s.personName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                    {s.displayName} · {format(parseISO(s.date), "MMM d")}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-[var(--faint)]">{s.reason}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => act(s.txnId, () => confirmSettlementSuggestion(s))}
                  disabled={working}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[var(--jade)] px-3.5 py-2 text-xs font-medium text-[var(--on-jade)] transition duration-200 hover:brightness-105 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
                >
                  <Check size={12} aria-hidden /> {working ? "Recording…" : "Confirm"}
                </button>
                <button
                  onClick={() => act(s.txnId, () => dismissSettlementSuggestion(s.txnId))}
                  disabled={working}
                  aria-label={`Not a repayment from ${s.personName}`}
                  title="Not a repayment"
                  className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-line text-[var(--faint)] transition-colors duration-200 hover:border-[var(--line-strong)] hover:text-[var(--paper)] disabled:cursor-default disabled:opacity-40"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

function PersonCard({
  person,
  index,
  focused,
  onFocus,
}: {
  person: PersonBalance;
  index: number;
  focused: boolean;
  onFocus: () => void;
}) {
  const router = useRouter();
  const [settling, setSettling] = useState(false);
  const [pending, start] = useTransition();

  const theyOwe = person.balance > 0;
  const pct = person.owed > 0 ? Math.min(100, Math.round((person.settled / person.owed) * 100)) : 0;

  return (
    <Card
      className={`rise flex flex-col p-5 transition-[border-color,box-shadow] duration-200 ${
        focused ? "border-[var(--brass)] shadow-[var(--elev-3)]" : ""
      }`}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        {/* The identity block is the filter control — one click scopes the
            ledger below to this person. */}
        <button
          onClick={onFocus}
          aria-pressed={focused}
          className="group flex min-w-0 cursor-pointer items-center gap-3 text-left"
        >
          <Avatar person={person} size="lg" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium transition-colors duration-200 group-hover:text-[var(--brass)]">
              {person.name}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
              {person.handle ?? `${person.expenseCount} ${person.expenseCount === 1 ? "split" : "splits"}`}
            </span>
          </span>
        </button>

        <button
          onClick={() =>
            start(async () => {
              await updatePerson(person.id, { archived: !person.archived });
              router.refresh();
            })
          }
          disabled={pending}
          aria-label={`${person.archived ? "Unarchive" : "Archive"} ${person.name}`}
          title={person.archived ? "Unarchive" : "Archive"}
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--faint)] transition-colors duration-200 hover:bg-[var(--panel-2)] hover:text-[var(--paper)] disabled:cursor-default disabled:opacity-40"
        >
          <Archive size={13} aria-hidden />
        </button>
      </div>

      <p
        className={`mono mt-4 text-3xl tabular ${theyOwe ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}
      >
        {formatCurrency(Math.abs(person.balance))}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {theyOwe ? "owes you" : "you owe them"}
        {person.settled > 0.01 && ` · ${formatCurrency(person.settled)} back so far`}
      </p>

      {/* How much of what they ever owed has come back. Silent for the trivial
          case (nothing repaid yet) so an empty bar isn't just noise. */}
      {theyOwe && person.settled > 0.01 && (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% of what ${person.name} owed has been paid back`}
          className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--panel-2)]"
        >
          <div
            className="h-full rounded-full bg-[var(--jade-deep)] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Only meaningful while they still owe you — recording a repayment
          against a negative balance would just deepen the overpayment. */}
      <div className="mt-auto pt-4">
        {!theyOwe ? (
          <p className="text-xs leading-relaxed text-[var(--faint)]">
            They&rsquo;ve paid back more than they owed. Split something with them to square it, or
            settle it off the books.
          </p>
        ) : settling ? (
          <SettleForm person={person} onDone={() => setSettling(false)} />
        ) : (
          <button
            onClick={() => setSettling(true)}
            className="w-full cursor-pointer rounded-full border border-line px-3 py-2 text-xs text-[var(--muted)] transition-colors duration-200 hover:border-[var(--line-strong)] hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
          >
            Record a repayment
          </button>
        )}
      </div>
    </Card>
  );
}

/** Hand-entered repayment — for cash and anything budgetr can't see. */
function SettleForm({ person, onDone }: { person: PersonBalance; onDone: () => void }) {
  const router = useRouter();
  const fieldId = useId();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const suggested = Math.abs(person.balance);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount || suggested);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount above zero.");
      return;
    }
    start(async () => {
      const res = await recordSettlement({
        personId: person.id,
        amount: value,
        date: format(new Date(), "yyyy-MM-dd"),
        note: "Recorded by hand",
      });
      if (!res.ok) {
        setError(res.error ?? "Could not record that.");
        return;
      }
      setError(null);
      onDone();
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-2.5 rounded-xl border border-line bg-[color-mix(in_srgb,var(--ink)_50%,transparent)] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={fieldId} className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
          Amount received
        </label>
        <button
          type="button"
          onClick={onDone}
          aria-label="Cancel recording a repayment"
          className="grid h-6 w-6 cursor-pointer place-items-center rounded-full text-[var(--faint)] transition-colors duration-200 hover:text-[var(--paper)]"
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          id={fieldId}
          value={amount}
          inputMode="decimal"
          autoFocus
          aria-describedby={`${fieldId}-help`}
          aria-invalid={error ? true : undefined}
          placeholder={suggested.toFixed(2)}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          className="mono min-w-0 flex-1 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-2 text-sm tabular outline-none transition-colors duration-200 focus:border-[var(--brass-dim)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-full bg-[var(--brass)] px-3.5 py-2 text-xs font-medium text-[var(--on-brass)] transition duration-200 hover:brightness-105 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
        >
          {pending ? "Saving…" : "Record"}
        </button>
      </div>

      <p id={`${fieldId}-help`} className="text-[11px] leading-relaxed text-[var(--faint)]">
        For cash, or a payment budgetr can&rsquo;t see. Bank repayments are better confirmed from
        the inbox above, which also files the transaction.
      </p>
      {error && (
        <p role="alert" className="text-xs text-[var(--coral)]">
          {error}
        </p>
      )}
    </form>
  );
}

/** Settled and archived people, at chip weight — present, but out of the way. */
function SquareStrip({
  people,
  focus,
  onFocus,
  className = "",
}: {
  people: PersonBalance[];
  focus: string | null;
  onFocus: (id: string) => void;
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {people.map((p) => {
        const active = focus === p.id;
        return (
          <li key={p.id}>
            <button
              onClick={() => onFocus(p.id)}
              aria-pressed={active}
              className={`flex cursor-pointer items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-xs transition-colors duration-200 ${
                active
                  ? "border-[var(--brass)] bg-[var(--panel-2)] text-[var(--paper)]"
                  : "border-line bg-[var(--panel)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
              }`}
            >
              <Avatar person={p} size="sm" />
              {p.name}
              <span className="text-[var(--faint)]">{p.archived ? "archived" : "settled"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Activity ledger ──────────────────────────────────────────────────────────

type LedgerItem =
  | { kind: "split"; key: string; date: string; row: SharedExpenseRow }
  | { kind: "repaid"; key: string; date: string; row: SettlementRow };

const PAGE = 14;
const FILTERS = [
  { id: "all", label: "All" },
  { id: "split", label: "Split" },
  { id: "repaid", label: "Repaid" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

/**
 * One chronological ledger instead of two parallel lists. Money out and money
 * back read as a single story, which is what makes the per-person filter useful.
 */
function Ledger({
  expenses,
  settlements,
  focused,
  onClearFocus,
}: {
  expenses: SharedExpenseRow[];
  settlements: SettlementRow[];
  focused: PersonBalance | null;
  onClearFocus: () => void;
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [limit, setLimit] = useState(PAGE);

  const items = useMemo(() => {
    const out: LedgerItem[] = [];
    if (filter !== "repaid") {
      for (const e of expenses) {
        if (focused && !e.shares.some((s) => s.personId === focused.id)) continue;
        out.push({ kind: "split", key: `e_${e.id}`, date: e.date, row: e });
      }
    }
    if (filter !== "split") {
      for (const s of settlements) {
        if (focused && s.personId !== focused.id) continue;
        out.push({ kind: "repaid", key: `s_${s.id}`, date: s.date, row: s });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, settlements, focused, filter]);

  // Month dividers give the list a spine to scan against.
  const shown = useMemo(() => {
    const page = items.slice(0, limit);
    return page.map((item, i) => {
      const month = format(parseISO(item.date), "MMMM yyyy");
      const prev = i > 0 ? format(parseISO(page[i - 1].date), "MMMM yyyy") : null;
      return { item, divider: month === prev ? null : month };
    });
  }, [items, limit]);

  return (
    <Card className="rise">
      <CardHeader className="flex-wrap items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <CardTitle>Activity</CardTitle>
          {focused && (
            <button
              onClick={onClearFocus}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] py-1 pl-1 pr-2.5 text-xs text-[var(--brass)] transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--brass)_20%,transparent)]"
            >
              <Avatar person={focused} size="sm" />
              {focused.name}
              <X size={12} aria-hidden />
              <span className="sr-only">Clear person filter</span>
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-[color-mix(in_srgb,var(--ink)_50%,transparent)] p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                setLimit(PAGE);
              }}
              aria-pressed={filter === f.id}
              className={`cursor-pointer rounded-full px-3 py-1.5 text-xs transition-colors duration-200 ${
                filter === f.id
                  ? "bg-[var(--panel-2)] text-[var(--paper)]"
                  : "text-[var(--muted)] hover:text-[var(--paper)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </CardHeader>

      {items.length === 0 ? (
        <EmptyState
          icon={<Receipt size={18} aria-hidden />}
          title={focused ? `Nothing yet with ${focused.name}` : "No shared activity yet"}
          body={
            focused
              ? "Split a transaction with them from its detail panel and it will show up here."
              : "Open a transaction, hit Split, and pick who was in on it. Splits and repayments both land in this ledger."
          }
        />
      ) : (
        <>
          <ul className="-mx-2">
            {shown.map(({ item, divider }, i) => (
              <li key={item.key}>
                {divider && (
                  <p
                    className={`mb-1.5 px-2 text-[11px] uppercase tracking-[0.14em] text-[var(--faint)] ${i === 0 ? "" : "mt-5"}`}
                  >
                    {divider}
                  </p>
                )}
                {item.kind === "split" ? (
                  <SplitLine expense={item.row} focusedId={focused?.id ?? null} />
                ) : (
                  <SettlementLine settlement={item.row} />
                )}
              </li>
            ))}
          </ul>

          {items.length > shown.length && (
            <button
              onClick={() => setLimit((n) => n + PAGE * 2)}
              className="mt-4 w-full cursor-pointer rounded-full border border-line py-2 text-xs text-[var(--muted)] transition-colors duration-200 hover:border-[var(--line-strong)] hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
            >
              Show {Math.min(PAGE * 2, items.length - shown.length)} more ·{" "}
              {items.length - shown.length} left
            </button>
          )}
        </>
      )}
    </Card>
  );
}

/** Money you fronted. Links out to the merchant's transactions. */
function SplitLine({
  expense,
  focusedId,
}: {
  expense: SharedExpenseRow;
  focusedId: string | null;
}) {
  const currency = expense.currency ?? undefined;
  const theirs = focusedId
    ? Math.abs(expense.shares.find((s) => s.personId === focusedId)?.amount ?? 0)
    : Math.abs(expense.total) - Math.abs(expense.myShare);

  return (
    <Link
      href={{ pathname: "/transactions", query: { q: expense.displayName } }}
      className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-200 hover:bg-[var(--panel-2)]"
    >
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-[var(--panel-2)] text-[var(--muted)]"
      >
        <ArrowUpRight size={13} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{expense.displayName}</span>
        <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">
          {format(parseISO(expense.date), "MMM d")} ·{" "}
          {expense.shares.map((s) => s.personName).join(", ")}
        </span>
      </span>

      <AvatarStack people={expense.shares} />

      <span className="shrink-0 text-right">
        <span className="mono block text-sm tabular">
          {formatCurrency(Math.abs(expense.total), currency)}
        </span>
        <span className="mono mt-0.5 block text-xs tabular text-[var(--jade)]">
          {formatCurrency(theirs, currency)} owed
        </span>
      </span>

      {/* Placeholder for the settlement rows' delete affordance, so both row
          types share one right edge. */}
      <span aria-hidden className="w-9 shrink-0" />
    </Link>
  );
}

/** Money that came back. */
function SettlementLine({ settlement }: { settlement: SettlementRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-200 hover:bg-[var(--panel-2)]">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--jade)_35%,transparent)] bg-[color-mix(in_srgb,var(--jade)_12%,transparent)] text-[var(--jade)]"
      >
        <ArrowDownLeft size={13} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {settlement.personName} <span className="text-[var(--muted)]">paid you back</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
          {format(parseISO(settlement.date), "MMM d")}
          {settlement.note ? ` · ${settlement.note}` : ""}
        </p>
      </div>

      <Avatar
        person={{ id: settlement.personId, name: settlement.personName }}
        size="sm"
        className="hidden sm:grid"
      />

      <span className="mono shrink-0 text-sm tabular text-[var(--jade)]">
        {formatCurrency(settlement.amount)}
      </span>

      <button
        onClick={() =>
          start(async () => {
            await removeSettlement(settlement.id);
            router.refresh();
          })
        }
        disabled={pending}
        aria-label={`Remove the repayment from ${settlement.personName}`}
        title="Remove repayment"
        // Revealed on hover at desk width, but always present on touch, where
        // there is no hover to reveal it with.
        className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--faint)] transition duration-200 hover:text-[var(--coral)] focus-visible:opacity-100 disabled:cursor-default disabled:opacity-40 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </div>
  );
}

// ── Add person ───────────────────────────────────────────────────────────────

function AddPerson() {
  const router = useRouter();
  const nameId = useId();
  const handleId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    start(async () => {
      const res = await createPerson({ name, handle });
      if (!res.ok) {
        setError(res.error ?? "Could not add them.");
        return;
      }
      setName("");
      setHandle("");
      setError(null);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3.5 py-2 text-xs text-[var(--muted)] transition-colors duration-200 hover:border-[var(--line-strong)] hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
      >
        <UserPlus size={13} aria-hidden /> Add person
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex w-full flex-wrap items-end gap-3 rounded-2xl border border-line bg-[var(--panel)] p-3.5 shadow-[var(--elev-1)] sm:w-auto"
    >
      <div className="min-w-0 flex-1 sm:flex-none">
        <label
          htmlFor={nameId}
          className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]"
        >
          Name
        </label>
        <input
          id={nameId}
          value={name}
          autoFocus
          required
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="w-full rounded-lg border border-line bg-[var(--ink)] px-2.5 py-2 text-sm outline-none transition-colors duration-200 focus:border-[var(--brass-dim)] sm:w-36"
        />
      </div>

      <div className="min-w-0 flex-1 sm:flex-none">
        <label
          htmlFor={handleId}
          className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]"
        >
          Handle <span className="normal-case tracking-normal">(optional)</span>
        </label>
        <input
          id={handleId}
          value={handle}
          placeholder="@venmo"
          autoComplete="off"
          onChange={(e) => setHandle(e.target.value)}
          className="w-full rounded-lg border border-line bg-[var(--ink)] px-2.5 py-2 text-sm outline-none transition-colors duration-200 focus:border-[var(--brass-dim)] sm:w-40"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="cursor-pointer rounded-full bg-[var(--brass)] px-3.5 py-2 text-xs font-medium text-[var(--on-brass)] transition duration-200 hover:brightness-105 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          aria-label="Cancel adding a person"
          className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[var(--faint)] transition-colors duration-200 hover:text-[var(--paper)]"
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {error && (
        <p role="alert" className="w-full text-xs text-[var(--coral)]">
          {error}
        </p>
      )}
    </form>
  );
}

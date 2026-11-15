"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ChevronDown, Trash2, X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  confirmSettlementSuggestion,
  createPerson,
  dismissSettlementSuggestion,
  recordSettlement,
  removeSettlement,
  updatePerson,
} from "@/lib/actions-sharing";
import { openLedger, splitMethodLabel, type OpenItem } from "@/lib/shared-ledger";
import type {
  PersonBalance,
  SettlementRow,
  SettlementSuggestion,
  SharedExpenseRow,
} from "@/lib/sharing";

// One column template per table, shared by its header rule and every row.
const PEOPLE_GRID =
  "grid grid-cols-[minmax(200px,1.4fr)_minmax(200px,1.6fr)_130px_250px] gap-5";
const ACTIVITY_GRID =
  "grid grid-cols-[56px_minmax(170px,1.3fr)_minmax(150px,1.1fr)_90px_100px_110px_140px] gap-5";

// The three button weights the page uses, at the 44px touch height.
const BTN = "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full text-sm transition duration-200 disabled:cursor-default disabled:opacity-40";
const BTN_PRIMARY = `${BTN} bg-[var(--jade)] px-[18px] font-semibold text-[var(--on-jade)] hover:brightness-105 active:scale-[0.98]`;
const BTN_OUTLINE = `${BTN} border border-[var(--line-strong)] px-4 text-[var(--paper)] hover:bg-[var(--panel-2)]`;
const BTN_QUIET = `${BTN} border border-line px-3.5 text-[13px] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]`;
const FIELD =
  "rounded-lg border border-line bg-[var(--ink)] px-2.5 py-2 text-sm outline-none transition-colors duration-200 focus:border-[var(--brass-dim)]";
const FIELD_LABEL = "mb-1 block text-xs text-[var(--muted)]";

/**
 * The Shared page body — the hero and its actions, the repayment inbox, the
 * people table, and one activity ledger underneath. Ruled rows throughout; the
 * only boxes are form fields.
 *
 * Navigation hinges on *focus*: selecting a person filters the ledger to just
 * them, so "what's the story with Sam" is one click rather than two lists read
 * side by side. Focus lives in client state (instant, no server round-trip) and
 * is mirrored into `?p=` so the view survives a reload and can be linked.
 */
export function SharedView({
  hero,
  people,
  expenses,
  settlements,
  suggestions,
}: {
  /** The server-rendered figure and verdict; the actions sit beside it here. */
  hero: React.ReactNode;
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
  // The two forms the hero buttons open. One at a time, in a ruled band under
  // the hero, so opening one never reflows the tables below it twice.
  const [panel, setPanel] = useState<"add" | "record" | null>(null);

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
  // Which shares are still unpaid — drives "Open items" and the ledger status.
  const ledger = useMemo(() => openLedger(expenses, people), [expenses, people]);

  const visible = people.filter((p) => !p.archived || Math.abs(p.balance) > 0.01);
  const owesYou = visible.filter((p) => p.balance > 0.01).sort((a, b) => b.balance - a.balance);
  const youOwe = visible.filter((p) => p.balance < -0.01).sort((a, b) => a.balance - b.balance);
  const square = visible.filter((p) => Math.abs(p.balance) <= 0.01);
  const archived = people.filter((p) => p.archived && Math.abs(p.balance) <= 0.01);
  // Settled people stay in the table, after everyone with a balance.
  const rows = [...owesYou, ...youOwe, ...square];

  const toggleFocus = (id: string) => setFocus(focus === id ? null : id);
  const pendingFor = (id: string) =>
    suggestions.filter((s) => s.personId === id).reduce((sum, s) => sum + s.amount, 0);

  return (
    <div className="space-y-9">
      <div className="space-y-5">
        <section
          className="rise flex flex-wrap items-end justify-between gap-x-10 gap-y-6"
          aria-label="Owed to you"
        >
          <div className="min-w-0 flex-[1_1_420px]">{hero}</div>
          <div className="flex flex-wrap gap-2">
            {/* A split is made on the transaction it divides, so this goes there. */}
            <Link href="/transactions" className={BTN_PRIMARY}>
              Split a bill
            </Link>
            {owesYou.length > 0 && (
              <button
                type="button"
                aria-expanded={panel === "record"}
                onClick={() => setPanel(panel === "record" ? null : "record")}
                className={BTN_OUTLINE}
              >
                Record a repayment
              </button>
            )}
            <button
              type="button"
              aria-expanded={panel === "add"}
              onClick={() => setPanel(panel === "add" ? null : "add")}
              className={BTN_OUTLINE}
            >
              Add person
            </button>
          </div>
        </section>

        {panel === "add" && <AddPersonForm onDone={() => setPanel(null)} />}
        {panel === "record" && (
          <RecordRepayment people={owesYou} onDone={() => setPanel(null)} />
        )}
      </div>

      {suggestions.length > 0 && <SuggestionInbox suggestions={suggestions} />}

      <section aria-labelledby="people-heading">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div
              className={`${PEOPLE_GRID} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
            >
              <h2
                id="people-heading"
                className="font-display text-lg tracking-tight text-[var(--paper)]"
              >
                People
                {visible.length > 0 && (
                  <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">
                    {visible.length}
                  </span>
                )}
              </h2>
              <span>Open items</span>
              <span className="text-right">Balance</span>
              <span />
            </div>

            {rows.length === 0 ? (
              <p className="flex min-h-[62px] items-center border-b border-line text-sm text-[var(--muted)]">
                No one here yet. Add someone above, or split a transaction from its detail panel
                and add them inline.
              </p>
            ) : (
              <ul>
                {rows.map((p) => (
                  <PersonRowItem
                    key={p.id}
                    person={p}
                    open={ledger.byPerson.get(p.id) ?? []}
                    toConfirm={pendingFor(p.id)}
                    focused={focus === p.id}
                    onFocus={() => toggleFocus(p.id)}
                  />
                ))}
              </ul>
            )}

            {archived.length > 0 && showArchived && (
              <ul id="archived-people">
                {archived.map((p) => (
                  <PersonRowItem
                    key={p.id}
                    person={p}
                    open={[]}
                    toConfirm={0}
                    focused={focus === p.id}
                    onFocus={() => toggleFocus(p.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="text-[13px] text-[var(--muted)]">
            Select a person to filter the activity below. Record is for cash, or a payment budgetr
            can&rsquo;t see.
          </p>
          {archived.length > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              aria-controls="archived-people"
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-[13px] text-[var(--muted)] transition-colors duration-200 hover:text-[var(--paper)]"
            >
              <ChevronDown
                size={13}
                aria-hidden
                className={`transition-transform duration-200 ${showArchived ? "rotate-180" : ""}`}
              />
              Archived · {archived.length}
            </button>
          )}
        </div>
      </section>

      <Ledger
        expenses={expenses}
        settlements={settlements}
        suggestions={suggestions}
        openByExpense={ledger.byExpense}
        openByPerson={ledger.byPerson}
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

// ── Repayments to confirm ────────────────────────────────────────────────────

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
    <section id="confirm" aria-labelledby="confirm-heading" className="rise scroll-mt-24">
      <div className="border-b border-[var(--line-strong)] pb-2.5">
        <h2 id="confirm-heading" className="font-display text-lg tracking-tight">
          Repayments to confirm
          <span className="mono ml-2 text-xs font-normal text-[var(--brass)]">
            {suggestions.length}
          </span>
        </h2>
      </div>

      <ul>
        {suggestions.map((s) => {
          const working = pending && busy === s.txnId;
          return (
            <li
              key={s.txnId}
              className="flex flex-wrap items-center gap-3 border-b border-line py-3"
            >
              <div className="min-w-0 flex-[1_1_320px]">
                <p className="font-medium">
                  {s.displayName}{" "}
                  <span className="mono font-normal tabular text-[var(--jade)]">
                    +{formatCurrency(s.amount, s.currency ?? undefined)}
                  </span>{" "}
                  <span className="mono text-xs font-normal text-[var(--muted)]">
                    {format(parseISO(s.date), "MMM d")}
                    {s.accountName ? ` · ${s.accountName}` : ""}
                  </span>
                </p>
                <p className="text-[13px] text-[var(--muted)]">
                  From {s.personName}. {s.reason}
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => act(s.txnId, () => confirmSettlementSuggestion(s))}
                  disabled={working}
                  className={BTN_PRIMARY}
                >
                  {working ? "Recording…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => act(s.txnId, () => dismissSettlementSuggestion(s.txnId))}
                  disabled={working}
                  aria-label={`Not a repayment from ${s.personName}`}
                  className={BTN_QUIET}
                >
                  Not a repayment
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

/** "Nopa $47.33 · Whole Foods $48.20" — the unpaid shares behind a balance. */
function openItemsLine(open: OpenItem[]): string {
  const shown = open.slice(0, 2).map((o) => `${o.displayName} ${formatCurrency(o.amount)}`);
  if (open.length > shown.length) shown.push(`${open.length - shown.length} more`);
  return shown.join(" · ");
}

function PersonRowItem({
  person,
  open,
  toConfirm,
  focused,
  onFocus,
}: {
  person: PersonBalance;
  /** Their unpaid shares, newest first. */
  open: OpenItem[];
  /** Inflows from them sitting in the inbox, not yet confirmed. */
  toConfirm: number;
  focused: boolean;
  onFocus: () => void;
}) {
  const router = useRouter();
  const [settling, setSettling] = useState(false);
  const [pending, start] = useTransition();

  const theyOwe = person.balance > 0.01;
  const iOwe = person.balance < -0.01;
  const splits = `${person.expenseCount} ${person.expenseCount === 1 ? "split" : "splits"}`;

  return (
    <li
      className={`border-b border-line transition-colors duration-200 ${
        focused ? "bg-[var(--panel-2)] shadow-[inset_2px_0_0_var(--brass)]" : ""
      }`}
    >
      <div className={`${PEOPLE_GRID} min-h-[62px] items-center py-1.5 ${focused ? "pl-3" : ""}`}>
        <span className="flex min-w-0 items-center gap-3">
          <Avatar person={person} />
          <span className="min-w-0">
            {/* The name is the filter control — one click scopes the ledger
                below to this person. */}
            <button
              type="button"
              onClick={onFocus}
              aria-pressed={focused}
              title={focused ? "Show everyone's activity" : `Show only ${person.name}'s activity`}
              className="block max-w-full cursor-pointer truncate text-left font-medium transition-colors duration-200 hover:text-[var(--brass)]"
            >
              {person.name}
            </button>
            <HandleEditor person={person} />
          </span>
        </span>

        <span className="min-w-0 text-[13px] text-[var(--muted)]">
          {iOwe ? (
            "Paid back more than they owed. Split something with them to square it, or settle it off the books."
          ) : (
            <>
              <span className="block truncate">
                {theyOwe
                  ? open.length > 0
                    ? openItemsLine(open)
                    : splits
                  : person.archived
                    ? `Archived · ${splits}`
                    : `Settled · ${splits}`}
                {toConfirm > 0.01 && (
                  <span className="text-[var(--brass)]">
                    {" · "}
                    {formatCurrency(toConfirm)} to confirm
                  </span>
                )}
              </span>
              {person.settled > 0.01 && (
                <span className="block text-xs">
                  {formatCurrency(person.settled)} back so far
                </span>
              )}
            </>
          )}
        </span>

        <span className="text-right">
          <span
            className={`mono tabular ${
              iOwe ? "text-[var(--coral)]" : theyOwe ? "text-[var(--paper)]" : "text-[var(--muted)]"
            }`}
          >
            {formatCurrency(Math.abs(person.balance))}
          </span>
          <span className="block text-xs text-[var(--muted)]">
            {theyOwe ? "owes you" : iOwe ? "you owe" : "settled"}
          </span>
        </span>

        <span className="flex justify-end gap-2">
          {/* Only meaningful while they still owe you — recording a repayment
              against a negative balance would just deepen the overpayment. */}
          {theyOwe && (
            <button
              type="button"
              onClick={() => setSettling((v) => !v)}
              aria-expanded={settling}
              className={`${BTN} border border-[var(--line-strong)] px-3.5 text-[13px] text-[var(--paper)] hover:bg-[var(--panel)]`}
            >
              Record repayment
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              start(async () => {
                await updatePerson(person.id, { archived: !person.archived });
                router.refresh();
              })
            }
            disabled={pending}
            aria-label={`${person.archived ? "Unarchive" : "Archive"} ${person.name}`}
            className={BTN_QUIET}
          >
            {person.archived ? "Unarchive" : "Archive"}
          </button>
        </span>
      </div>

      {settling && (
        <div className={`pb-4 ${focused ? "pl-3" : ""}`}>
          <SettleForm person={person} onDone={() => setSettling(false)} />
        </div>
      )}
    </li>
  );
}

/**
 * The payment handle under a name. Click to set or change it — the handle is
 * what the iOS companion opens a Venmo request against, and until now it could
 * only be given when the person was first added.
 */
function HandleEditor({ person }: { person: PersonBalance }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(person.handle ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updatePerson(person.id, { handle: value });
      if (!res.ok) {
        setError(res.error ?? "Could not save that.");
        return;
      }
      setError(null);
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(person.handle ?? "");
          setEditing(true);
        }}
        title={person.handle ? "Change handle" : "Add a payment handle"}
        className="mono block max-w-full cursor-pointer truncate text-left text-xs text-[var(--muted)] transition-colors duration-200 hover:text-[var(--paper)]"
      >
        {person.handle ?? "No handle"}
      </button>
    );
  }

  return (
    <form onSubmit={save} className="mt-0.5 flex items-center gap-1.5">
      <input
        value={value}
        autoFocus
        autoComplete="off"
        placeholder="@venmo"
        aria-label={`Handle for ${person.name}`}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        className="mono w-32 rounded-md border border-line bg-[var(--ink)] px-2 py-1 text-xs outline-none focus:border-[var(--brass-dim)]"
      />
      <button
        type="submit"
        disabled={pending}
        className="cursor-pointer text-xs text-[var(--brass)] hover:underline disabled:opacity-40"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        aria-label="Cancel editing the handle"
        className="grid h-6 w-6 cursor-pointer place-items-center rounded-full text-[var(--muted)] hover:text-[var(--paper)]"
      >
        <X size={12} aria-hidden />
      </button>
      {error && (
        <span role="alert" className="text-xs text-[var(--coral)]">
          {error}
        </span>
      )}
    </form>
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
    <form onSubmit={submit} className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div>
        <label htmlFor={fieldId} className={FIELD_LABEL}>
          Amount received from {person.name}
        </label>
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
          className={`${FIELD} mono w-40 tabular`}
        />
      </div>
      <button type="submit" disabled={pending} className={BTN_PRIMARY}>
        {pending ? "Saving…" : "Record"}
      </button>
      <button type="button" onClick={onDone} className={BTN_QUIET}>
        Cancel
      </button>
      <p id={`${fieldId}-help`} className="w-full max-w-xl text-xs leading-relaxed text-[var(--muted)]">
        For cash, or a payment budgetr can&rsquo;t see. Bank repayments are better confirmed from
        the inbox, which also files the transaction.
      </p>
      {error && (
        <p role="alert" className="w-full text-xs text-[var(--coral)]">
          {error}
        </p>
      )}
    </form>
  );
}

/** The hero's "Record a repayment": pick who, then the same form a row opens. */
function RecordRepayment({ people, onDone }: { people: PersonBalance[]; onDone: () => void }) {
  const selectId = useId();
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const person = people.find((p) => p.id === personId) ?? people[0];
  if (!person) return null;

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 border-y border-line py-4">
      <div>
        <label htmlFor={selectId} className={FIELD_LABEL}>
          Who paid you back
        </label>
        <select
          id={selectId}
          value={person.id}
          onChange={(e) => setPersonId(e.target.value)}
          className={`${FIELD} min-h-[38px] w-48`}
        >
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — owes {formatCurrency(p.balance)}
            </option>
          ))}
        </select>
      </div>
      {/* Keyed so the amount and any error reset when the person changes. */}
      <SettleForm key={person.id} person={person} onDone={onDone} />
    </div>
  );
}

// ── Activity ledger ──────────────────────────────────────────────────────────

type LedgerItem =
  | { kind: "split"; key: string; date: string; row: SharedExpenseRow }
  | { kind: "repaid"; key: string; date: string; row: SettlementRow }
  | { kind: "suggested"; key: string; date: string; row: SettlementSuggestion };

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
  suggestions,
  openByExpense,
  openByPerson,
  focused,
  onClearFocus,
}: {
  expenses: SharedExpenseRow[];
  settlements: SettlementRow[];
  suggestions: SettlementSuggestion[];
  openByExpense: Map<string, number>;
  openByPerson: Map<string, OpenItem[]>;
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
      // Inflows still waiting in the inbox: money back, just not yet confirmed.
      for (const s of suggestions) {
        if (focused && s.personId !== focused.id) continue;
        out.push({ kind: "suggested", key: `g_${s.txnId}`, date: s.date, row: s });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, settlements, suggestions, focused, filter]);

  // Month dividers give the list a spine to scan against.
  const shown = useMemo(() => {
    const page = items.slice(0, limit);
    return page.map((item, i) => {
      const month = format(parseISO(item.date), "MMMM yyyy");
      const prev = i > 0 ? format(parseISO(page[i - 1].date), "MMMM yyyy") : null;
      return { item, divider: month === prev ? null : month };
    });
  }, [items, limit]);

  // With a person in focus, "open" means open *for them* on that expense.
  const focusedOpen = useMemo(() => {
    if (!focused) return null;
    return new Map((openByPerson.get(focused.id) ?? []).map((o) => [o.expenseId, o.amount]));
  }, [focused, openByPerson]);

  return (
    <section aria-labelledby="activity-heading" className="rise">
      <div className="overflow-x-auto">
        <div className="min-w-[940px]">
          <div
            className={`${ACTIVITY_GRID} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
          >
            <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2
                id="activity-heading"
                className="font-display text-lg tracking-tight text-[var(--paper)]"
              >
                Activity
              </h2>
              <div role="group" aria-label="Show" className="flex items-center gap-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFilter(f.id);
                      setLimit(PAGE);
                    }}
                    aria-pressed={filter === f.id}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-colors duration-200 ${
                      filter === f.id
                        ? "border-[var(--line-strong)] bg-[var(--panel-2)] text-[var(--paper)]"
                        : "border-transparent text-[var(--muted)] hover:text-[var(--paper)]"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <span className="flex min-w-0 items-center gap-2">
              With
              {focused && (
                <button
                  type="button"
                  onClick={onClearFocus}
                  className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--brass-dim)] py-0.5 pl-0.5 pr-2 text-xs text-[var(--brass)] transition-colors duration-200 hover:bg-[color-mix(in_srgb,var(--brass)_14%,transparent)]"
                >
                  <Avatar person={focused} size="sm" />
                  <span className="truncate">{focused.name}</span>
                  <X size={12} aria-hidden className="shrink-0" />
                  <span className="sr-only">Clear person filter</span>
                </button>
              )}
            </span>
            <span>Split</span>
            <span className="text-right">Total</span>
            <span className="text-right">Owed to you</span>
            <span />
          </div>

          {items.length === 0 ? (
            <p className="flex min-h-[52px] items-center border-b border-line py-3 text-sm text-[var(--muted)]">
              {focused
                ? `Nothing yet with ${focused.name}. Split a transaction with them from its detail panel and it will show up here.`
                : "No shared activity yet. Open a transaction, hit Split, and pick who was in on it. Splits and repayments both land in this ledger."}
            </p>
          ) : (
            <ul>
              {shown.map(({ item, divider }, i) => (
                <li key={item.key}>
                  {divider && (
                    <p
                      className={`pb-1.5 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] ${i === 0 ? "pt-3" : "pt-6"}`}
                    >
                      {divider}
                    </p>
                  )}
                  {item.kind === "split" ? (
                    <SplitLine
                      expense={item.row}
                      focusedId={focused?.id ?? null}
                      open={
                        focusedOpen
                          ? (focusedOpen.get(item.row.id) ?? 0)
                          : (openByExpense.get(item.row.id) ?? 0)
                      }
                    />
                  ) : item.kind === "repaid" ? (
                    <SettlementLine settlement={item.row} />
                  ) : (
                    <SuggestedLine suggestion={item.row} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="text-[13px] text-[var(--muted)]">
          Open a row to find its transaction and edit the split: evenly, by amounts, by percent, or
          by item from a scanned receipt.
        </p>
        {items.length > shown.length && (
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE * 2)}
            className={BTN_QUIET}
          >
            Show {Math.min(PAGE * 2, items.length - shown.length)} more ·{" "}
            {items.length - shown.length} left
          </button>
        )}
      </div>
    </section>
  );
}

const LEDGER_ROW = `${ACTIVITY_GRID} min-h-[52px] items-center border-b border-line py-1.5`;

/** Money you fronted. Links out to the merchant's transactions. */
function SplitLine({
  expense,
  focusedId,
  open,
}: {
  expense: SharedExpenseRow;
  focusedId: string | null;
  /** Still unpaid on this expense (for the focused person, when there is one). */
  open: number;
}) {
  const currency = expense.currency ?? undefined;
  const theirs = focusedId
    ? Math.abs(expense.shares.find((s) => s.personId === focusedId)?.amount ?? 0)
    : Math.abs(expense.total) - Math.abs(expense.myShare);
  const isOpen = open > 0.01;

  return (
    <Link
      href={{ pathname: "/transactions", query: { q: expense.displayName } }}
      className={`${LEDGER_ROW} transition-colors duration-200 hover:bg-[var(--panel-2)]`}
    >
      <span className="mono text-xs text-[var(--muted)]">
        {format(parseISO(expense.date), "MMM d")}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{expense.displayName}</span>
        {expense.note && (
          <span className="block truncate text-xs text-[var(--muted)]">{expense.note}</span>
        )}
      </span>
      <span className="min-w-0 truncate text-[13px] text-[var(--muted)]">
        {expense.shares.map((s) => s.personName).join(", ")}
      </span>
      <span className="text-[13px] text-[var(--muted)]">{splitMethodLabel(expense)}</span>
      <span className="mono text-right tabular">
        {formatCurrency(Math.abs(expense.total), currency)}
      </span>
      <span className="mono text-right tabular">{formatCurrency(theirs, currency)}</span>
      <span
        className={`text-right text-xs ${isOpen ? "text-[var(--brass)]" : "text-[var(--muted)]"}`}
      >
        {isOpen ? "Open" : "Repaid"}
      </span>
    </Link>
  );
}

/** Money that came back. */
function SettlementLine({ settlement }: { settlement: SettlementRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className={LEDGER_ROW}>
      <span className="mono text-xs text-[var(--muted)]">
        {format(parseISO(settlement.date), "MMM d")}
      </span>
      <span className="min-w-0 truncate font-medium">{settlement.personName} paid you back</span>
      <span className="min-w-0 truncate text-[13px] text-[var(--muted)]">
        {settlement.personName}
      </span>
      <span className="text-[13px] text-[var(--muted)]">Repayment</span>
      <span className="mono text-right tabular text-[var(--jade)]">
        +{formatCurrency(settlement.amount)}
      </span>
      <span className="mono text-right text-[var(--muted)]">—</span>
      <span className="flex min-w-0 items-center justify-end gap-1">
        <span className="min-w-0 truncate text-right text-xs text-[var(--muted)]" title={settlement.note ?? undefined}>
          {settlement.note ?? "Repaid"}
        </span>
        <button
          type="button"
          onClick={() =>
            start(async () => {
              await removeSettlement(settlement.id);
              router.refresh();
            })
          }
          disabled={pending}
          aria-label={`Remove the repayment from ${settlement.personName}`}
          title="Remove repayment"
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition-colors duration-200 hover:text-[var(--coral)] disabled:cursor-default disabled:opacity-40"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </span>
    </div>
  );
}

/** An inflow that looks like a repayment but hasn't been confirmed yet. */
function SuggestedLine({ suggestion: s }: { suggestion: SettlementSuggestion }) {
  return (
    <a
      href="#confirm"
      className={`${LEDGER_ROW} transition-colors duration-200 hover:bg-[var(--panel-2)]`}
    >
      <span className="mono text-xs text-[var(--muted)]">{format(parseISO(s.date), "MMM d")}</span>
      <span className="min-w-0 truncate font-medium">{s.displayName}</span>
      <span className="min-w-0 truncate text-[13px] text-[var(--muted)]">{s.personName}</span>
      <span className="text-[13px] text-[var(--muted)]">Repayment</span>
      <span className="mono text-right tabular text-[var(--jade)]">
        +{formatCurrency(s.amount, s.currency ?? undefined)}
      </span>
      <span className="mono text-right text-[var(--muted)]">—</span>
      <span className="text-right text-xs text-[var(--brass)]">To confirm</span>
    </a>
  );
}

// ── Add person ───────────────────────────────────────────────────────────────

function AddPersonForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const nameId = useId();
  const handleId = useId();
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
      onDone();
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-x-3 gap-y-2 border-y border-line py-4"
    >
      <div className="min-w-0 flex-1 sm:flex-none">
        <label htmlFor={nameId} className={FIELD_LABEL}>
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
          className={`${FIELD} w-full sm:w-44`}
        />
      </div>

      <div className="min-w-0 flex-1 sm:flex-none">
        <label htmlFor={handleId} className={FIELD_LABEL}>
          Handle (optional)
        </label>
        <input
          id={handleId}
          value={handle}
          placeholder="@venmo"
          autoComplete="off"
          onChange={(e) => setHandle(e.target.value)}
          className={`${FIELD} w-full sm:w-44`}
        />
      </div>

      <button type="submit" disabled={pending || !name.trim()} className={BTN_PRIMARY}>
        {pending ? "Adding…" : "Add"}
      </button>
      <button type="button" onClick={onDone} className={BTN_QUIET}>
        Cancel
      </button>

      {error && (
        <p role="alert" className="w-full text-xs text-[var(--coral)]">
          {error}
        </p>
      )}
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Check, Sparkles, Trash2, UserPlus, X } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
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
 * The Shared page body — balances per person, the repayment inbox, and the two
 * underlying ledgers (what was split, what came back).
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
  const active = people.filter((p) => !p.archived || Math.abs(p.balance) > 0.01);

  return (
    <div className="space-y-7">
      {suggestions.length > 0 && <SuggestionInbox suggestions={suggestions} />}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="eyebrow">People</p>
          <AddPerson />
        </div>
        {active.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--muted)]">
              No one yet. Add someone here, or split a transaction from its detail panel and add
              them inline.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((p) => (
              <PersonCard key={p.id} person={p} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Split bills</CardTitle>
          </CardHeader>
          {expenses.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing split yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {expenses.slice(0, 12).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{e.displayName}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {format(new Date(`${e.date}T00:00:00`), "MMM d")} ·{" "}
                      {e.shares.map((s) => s.personName).join(", ")}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="mono text-sm">
                      {formatCurrency(Math.abs(e.total), e.currency ?? undefined)}
                    </p>
                    <p className="mono mt-0.5 text-xs text-[var(--jade)]">
                      {formatCurrency(
                        Math.abs(e.total) - Math.abs(e.myShare),
                        e.currency ?? undefined,
                      )}{" "}
                      owed
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Repayments</CardTitle>
          </CardHeader>
          {settlements.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing paid back yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {settlements.slice(0, 12).map((s) => (
                <SettlementLine key={s.id} settlement={s} />
              ))}
            </ul>
          )}
        </Card>
      </div>
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Sparkles size={13} className="text-[var(--brass)]" /> Repayments to confirm
        </CardTitle>
        <span className="text-xs text-[var(--muted)]">{suggestions.length}</span>
      </CardHeader>
      <ul className="space-y-2">
        {suggestions.map((s) => (
          <li
            key={s.txnId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="mono">{formatCurrency(s.amount, s.currency ?? undefined)}</span>{" "}
                from {s.personName}
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                {s.displayName} · {format(new Date(`${s.date}T00:00:00`), "MMM d")} · {s.reason}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                onClick={() => act(s.txnId, () => confirmSettlementSuggestion(s))}
                disabled={pending && busy === s.txnId}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--jade)] px-3 py-1.5 text-xs font-medium text-[var(--on-jade)] transition hover:brightness-105 disabled:opacity-40"
              >
                <Check size={12} /> It&rsquo;s a repayment
              </button>
              <button
                onClick={() => act(s.txnId, () => dismissSettlementSuggestion(s.txnId))}
                disabled={pending && busy === s.txnId}
                aria-label="Not a repayment"
                className="rounded-full border border-line p-1.5 text-[var(--faint)] hover:text-[var(--paper)] disabled:opacity-40"
              >
                <X size={13} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PersonCard({ person }: { person: PersonBalance }) {
  const router = useRouter();
  const [settling, setSettling] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const square = Math.abs(person.balance) < 0.01;

  function settle() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount.");
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
      setSettling(false);
      setAmount("");
      setError(null);
      router.refresh();
    });
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm">{person.name}</p>
          {person.handle && (
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{person.handle}</p>
          )}
        </div>
        <button
          onClick={() =>
            start(async () => {
              await updatePerson(person.id, { archived: !person.archived });
              router.refresh();
            })
          }
          className="shrink-0 text-xs text-[var(--faint)] hover:text-[var(--paper)]"
        >
          {person.archived ? "Unarchive" : "Archive"}
        </button>
      </div>

      <p
        className={`mono mt-3 text-2xl tabular ${square ? "text-[var(--muted)]" : "text-[var(--jade)]"}`}
      >
        {formatCurrency(person.balance)}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {square
          ? "Settled up"
          : `owes you · ${formatCurrency(person.settled)} paid back so far`}
      </p>

      {!square &&
        (settling ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={amount}
                inputMode="decimal"
                autoFocus
                placeholder={Math.abs(person.balance).toFixed(2)}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && settle()}
                className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
              />
              <button
                onClick={settle}
                disabled={pending}
                className="rounded-full bg-[var(--brass)] px-3 py-1.5 text-xs font-medium text-[var(--on-brass)] disabled:opacity-40"
              >
                Record
              </button>
              <button
                onClick={() => {
                  setSettling(false);
                  setError(null);
                }}
                aria-label="Cancel"
                className="rounded-md p-1 text-[var(--faint)] hover:text-[var(--paper)]"
              >
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-[var(--faint)]">
              For cash or a payment budgetr can&rsquo;t see. Bank repayments are better confirmed
              from the inbox above, which also files the transaction.
            </p>
            {error && <p className="text-xs text-[var(--coral)]">{error}</p>}
          </div>
        ) : (
          <button
            onClick={() => setSettling(true)}
            className="mt-3 rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--paper)]"
          >
            Record a repayment
          </button>
        ))}
    </Card>
  );
}

function SettlementLine({ settlement }: { settlement: SettlementRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <li className="group flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p className="truncate">{settlement.personName}</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {format(new Date(`${settlement.date}T00:00:00`), "MMM d")}
          {settlement.note ? ` · ${settlement.note}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="mono text-sm text-[var(--jade)]">
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
          aria-label="Remove repayment"
          className="rounded-md p-1 text-[var(--faint)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--coral)] disabled:opacity-40"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}

function AddPerson() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
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
        className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--paper)]"
      >
        <UserPlus size={12} /> Add person
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        autoFocus
        placeholder="Name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="w-32 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
      />
      <input
        value={handle}
        placeholder="@venmo (optional)"
        onChange={(e) => setHandle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="w-40 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--brass-dim)]"
      />
      <button
        onClick={submit}
        disabled={pending || !name.trim()}
        className="rounded-full bg-[var(--brass)] px-3 py-1.5 text-xs font-medium text-[var(--on-brass)] disabled:opacity-40"
      >
        Add
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="rounded-md p-1 text-[var(--faint)] hover:text-[var(--paper)]"
      >
        <X size={14} />
      </button>
      {error && <p className="w-full text-xs text-[var(--coral)]">{error}</p>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { renameRecurringStream } from "@/lib/actions/recurring";
import { daysLate, monthlyCommitment, splitByDue, streamLabel } from "@/lib/recurring";
import { formatCurrency } from "@/lib/utils";
import type { RecurringRow } from "@/lib/queries";

const FREQUENCY_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
  ANNUALLY: "Yearly",
  UNKNOWN: "Irregular",
};

const prettyFrequency = (f: string | null) => (f && FREQUENCY_LABEL[f]) ?? "Recurring";

/**
 * Recurring streams, triaged.
 *
 * Three things the flat list couldn't say: that a "Next" date in the past is a
 * different fact from a bill that's coming; that a total across mixed
 * frequencies isn't "per period" but per *month*, once normalised; and that a
 * stream Plaid never named can be named by you.
 */
export function RecurringView({
  bills,
  income,
  today,
}: {
  bills: RecurringRow[];
  income: RecurringRow[];
  today: string;
}) {
  const { total, irregular } = monthlyCommitment(bills);
  const due = splitByDue(bills, today);
  const soonTotal = due.soon.reduce((s, r) => s + Math.abs(r.averageAmount ?? 0), 0);
  const largest = [...bills].sort(
    (a, b) => Math.abs(b.averageAmount ?? 0) - Math.abs(a.averageAmount ?? 0),
  )[0];

  return (
    <div className="space-y-7">
      <Card>
        <p className="eyebrow">Committed monthly · {bills.length} active streams</p>
        <p className="display-1 mt-1.5 font-display text-5xl tabular">{formatCurrency(total)}</p>
        <p className="mt-3 text-sm text-[var(--muted)]">
          normalised to a monthly equivalent, so weekly and yearly streams are comparable.
          {irregular > 0 && (
            <>
              {" "}
              {irregular} irregular {irregular === 1 ? "stream is" : "streams are"} not included —
              they have no monthly figure.
            </>
          )}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          <Stat label="Due next 7 days" value={formatCurrency(soonTotal)} sub={`${due.soon.length} bills`} />
          <Stat
            label="Largest"
            value={largest ? formatCurrency(Math.abs(largest.averageAmount ?? 0)) : "—"}
            sub={largest ? streamLabel(largest).name : undefined}
          />
          <Stat
            label="Awaiting confirmation"
            value={String(due.overdue.length)}
            sub={due.overdue.length > 0 ? "past their date" : "none"}
            tone={due.overdue.length > 0 ? "brass" : undefined}
          />
        </div>
      </Card>

      {due.overdue.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border border-[var(--brass-dim)] bg-[color-mix(in_srgb,var(--brass)_12%,transparent)] px-4 py-3 text-sm">
          <AlertTriangle size={15} className="shrink-0 text-[var(--brass)]" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">
              {due.overdue.length} {due.overdue.length === 1 ? "stream was" : "streams were"} due
              before today
            </span>
            <span className="text-[var(--muted)]">
              {" — "}
              and no matching charge has arrived. Expected while a sync is behind; worth a look
              otherwise.
            </span>
          </p>
        </div>
      )}

      {due.overdue.length > 0 && (
        <Section title="Awaiting confirmation" rows={due.overdue} today={today} />
      )}
      {due.soon.length > 0 && <Section title="Due next 7 days" rows={due.soon} today={today} />}
      {due.later.length > 0 && <Section title="Upcoming" rows={due.later} today={today} />}
      {income.length > 0 && <Section title="Income" rows={income} today={today} />}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "brass";
}) {
  return (
    <div className="bg-[var(--panel)] px-4 py-3">
      <p className="eyebrow">{label}</p>
      <p
        className={`mono mt-1 text-lg tabular ${tone === "brass" ? "text-[var(--brass)]" : ""}`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

function Section({
  title,
  rows,
  today,
}: {
  title: string;
  rows: RecurringRow[];
  today: string;
}) {
  return (
    <section>
      <p className="eyebrow mb-3">
        {title} · {rows.length}
      </p>
      <div className="overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]">
        <ul>
          {rows.map((r) => (
            <Row key={r.id} row={r} today={today} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function Row({ row, today }: { row: RecurringRow; today: string }) {
  const income = row.direction === "inflow";
  const amount = Math.abs(row.averageAmount ?? 0);
  const { name, needsName } = streamLabel(row);
  const late = daysLate(row.predictedNextDate, today);

  return (
    <li className="flex items-center gap-4 border-b border-line/60 px-6 py-4 transition-colors last:border-0 hover:bg-[var(--panel-2)]">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${
          income
            ? "border-[color-mix(in_srgb,var(--jade)_35%,transparent)] text-[var(--jade)]"
            : "border-line text-[var(--muted)]"
        }`}
      >
        {income ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{name}</p>
          {late > 0 && (
            <span className="shrink-0 rounded-full border border-[var(--brass-dim)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--brass)]">
              {late}d late
            </span>
          )}
          <NameEditor id={row.id} current={row.userLabel} needsName={needsName} />
        </div>
        <p className="truncate text-xs text-[var(--muted)]">
          {prettyFrequency(row.frequency)} · {row.accountName}
          {row.predictedNextDate && (
            <>
              {" · "}
              {late > 0 ? "expected" : "due"} {format(parseISO(row.predictedNextDate), "MMM d")}
            </>
          )}
        </p>
      </div>

      <span
        className={`mono w-24 shrink-0 text-right text-sm ${
          income ? "text-[var(--jade)]" : "text-[var(--paper)]"
        }`}
      >
        {formatCurrency(amount, row.currency ?? "USD")}
      </span>
    </li>
  );
}

/**
 * Inline rename. Shown as a prompt on streams Plaid never named — where the
 * value is highest — and as a quiet pencil on the rest, so an already-correct
 * merchant name doesn't invite editing.
 */
function NameEditor({
  id,
  current,
  needsName,
}: {
  id: string;
  current: string | null;
  needsName: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      await renameRecurringStream(id, value);
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
          needsName
            ? "border-[var(--brass-dim)] text-[var(--brass)] hover:bg-[var(--panel-2)]"
            : "border-transparent text-[var(--faint)] hover:border-line hover:text-[var(--muted)]"
        }`}
        aria-label={`Rename this stream`}
      >
        {needsName ? "Name it" : <Pencil size={11} aria-hidden />}
      </button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="Mortgage, rent…"
        className="w-40 rounded-md border border-line bg-[var(--panel-2)] px-2 py-0.5 text-xs text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
      />
      <button
        onClick={save}
        disabled={pending}
        aria-label="Save name"
        className="cursor-pointer text-[var(--jade)] disabled:opacity-50"
      >
        <Check size={13} />
      </button>
    </span>
  );
}

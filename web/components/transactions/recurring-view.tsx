"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, Check, Pencil } from "lucide-react";
import { Figure, Hero, Mark } from "@/components/ui/statement";
import { renameRecurringStream } from "@/lib/actions/recurring";
import { cadenceLabel, commitmentLead } from "@/lib/plan-verdict";
import { daysLate, monthlyCommitment, splitByDue, streamLabel } from "@/lib/recurring";
import { formatCurrency } from "@/lib/utils";
import type { RecurringRow } from "@/lib/queries";

const prettyFrequency = cadenceLabel;

/**
 * Recurring streams, triaged.
 *
 * Three things the flat list couldn't say: that a "Next" date in the past is a
 * different fact from a bill that's coming; that a total across mixed
 * frequencies isn't "per period" but per *month*, once normalised; and that a
 * stream Plaid never named can be named by you.
 *
 * Laid out as a statement: the monthly commitment and the sentence that reads
 * it, three figures on a rule beside it, then one ruled table per due-group
 * sharing a single column set.
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
  const lead = commitmentLead(bills, total);
  const late = due.overdue.length;

  return (
    <div className="space-y-9">
      <section aria-label="Monthly commitment" className="flex flex-wrap items-stretch gap-10">
        <Hero
          className="flex-[1_1_380px]"
          eyebrow={`Committed each month · ${bills.length} active stream${bills.length === 1 ? "" : "s"}`}
          figure={formatCurrency(total)}
          verdict={
            lead ? (
              <>
                {streamLabel(lead.row).name} is{" "}
                <Mark tone="brass">{Math.round(lead.share * 100)}% of it</Mark>.{" "}
                {late > 0
                  ? `${late === 1 ? "One bill is" : `${late} bills are`} past ${
                      late === 1 ? "its" : "their"
                    } date with no charge seen yet.`
                  : "Nothing is past its date."}
              </>
            ) : (
              <span className="text-[var(--muted)]">
                No bill has a regular cadence yet, so there is no monthly figure to commit to.
              </span>
            )
          }
        >
          <p className="max-w-[60ch] text-[13px] text-[var(--muted)]">
            Every stream is normalised to a monthly equivalent, so weekly and yearly ones are
            comparable.
            {irregular > 0 && (
              <>
                {" "}
                {irregular} irregular {irregular === 1 ? "stream is" : "streams are"} not included;{" "}
                {irregular === 1 ? "it has" : "they have"} no monthly figure.
              </>
            )}
          </p>
        </Hero>

        <dl className="flex flex-[1_1_380px] flex-wrap gap-y-4 self-end border-t border-line pt-3.5">
          <BigStat
            label="Due next 7 days"
            value={formatCurrency(soonTotal)}
            sub={`${due.soon.length} bill${due.soon.length === 1 ? "" : "s"}`}
          />
          <BigStat
            label="Largest"
            value={largest ? formatCurrency(Math.abs(largest.averageAmount ?? 0)) : "—"}
            sub={largest ? streamLabel(largest).name : undefined}
          />
          <BigStat
            label="Awaiting confirmation"
            value={String(late)}
            sub={late > 0 ? "past their date" : "none"}
            tone={late > 0 ? "brass" : undefined}
          />
        </dl>
      </section>

      <section aria-label="Recurring streams">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            {late > 0 && (
              <Group
                title="Awaiting confirmation"
                dateHead="Expected"
                tone="brass"
                rows={due.overdue}
                today={today}
                note={`${late} ${late === 1 ? "stream was" : "streams were"} due before today and no matching charge has arrived.`}
              />
            )}
            {due.soon.length > 0 && (
              <Group title="Due next 7 days" dateHead="Due" rows={due.soon} today={today} />
            )}
            {due.later.length > 0 && (
              <Group title="Upcoming" dateHead="Due" rows={due.later} today={today} />
            )}
            {income.length > 0 && (
              <Group title="Income" dateHead="Due" rows={income} today={today} />
            )}
          </div>
        </div>
        <p className="text-[13px] text-[var(--muted)]">
          The pencil renames a stream; streams your bank never named ask for one. Late items are
          expected while a sync is behind, and worth a look otherwise.
        </p>
      </section>
    </div>
  );
}

/** A strip cell whose figure is set in the display face, one rank under the hero. */
function BigStat({
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
    <div className="min-w-[7.5rem] flex-1 border-l border-line px-4 first:border-l-0 first:pl-0">
      <dt className="text-[13px] text-[var(--muted)]">{label}</dt>
      <dd
        className={`font-display text-2xl tabular ${tone === "brass" ? "text-[var(--brass)]" : ""}`}
      >
        <Figure value={value} />
      </dd>
      {sub && <dd className="truncate text-xs text-[var(--muted)]">{sub}</dd>}
    </div>
  );
}

const COLS =
  "grid grid-cols-[24px_minmax(200px,1.6fr)_minmax(120px,0.9fr)_minmax(110px,0.8fr)_150px_120px] gap-4";

function Group({
  title,
  dateHead,
  rows,
  today,
  note,
  tone,
}: {
  title: string;
  dateHead: string;
  rows: RecurringRow[];
  today: string;
  note?: string;
  tone?: "brass";
}) {
  return (
    <div className="pb-7">
      <div
        className={`${COLS} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
      >
        <span />
        <h2 className="font-display text-lg tracking-tight text-[var(--paper)]">
          {title}
          <span
            className={`mono ml-2 text-xs ${tone === "brass" ? "text-[var(--brass)]" : "text-[var(--muted)]"}`}
          >
            {rows.length}
          </span>
        </h2>
        <span>Cadence</span>
        <span>Account</span>
        <span>{dateHead}</span>
        <span className="text-right">Amount</span>
      </div>
      {note && (
        <p className="border-b border-line py-2.5 text-[13px] text-[var(--brass)]">{note}</p>
      )}
      <ul>
        {rows.map((r) => (
          <Row key={r.id} row={r} today={today} />
        ))}
      </ul>
    </div>
  );
}

function Row({ row, today }: { row: RecurringRow; today: string }) {
  const income = row.direction === "inflow";
  const amount = Math.abs(row.averageAmount ?? 0);
  const { name, needsName } = streamLabel(row);
  const late = daysLate(row.predictedNextDate, today);

  return (
    <li className={`${COLS} min-h-14 items-center border-b border-line`}>
      {income ? (
        <ArrowDownLeft size={16} role="img" aria-label="Income" className="text-[var(--jade)]" />
      ) : (
        <ArrowUpRight size={16} role="img" aria-label="Bill" className="text-[var(--muted)]" />
      )}
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`truncate font-medium ${needsName ? "text-[var(--muted)]" : ""}`}>
          {name}
        </span>
        <NameEditor id={row.id} current={row.userLabel} needsName={needsName} />
      </span>
      <span className="truncate text-[13px] text-[var(--muted)]">
        {prettyFrequency(row.frequency)}
      </span>
      <span className="truncate text-[13px] text-[var(--muted)]">{row.accountName ?? "—"}</span>
      <span className={`mono text-xs ${late > 0 ? "text-[var(--brass)]" : "text-[var(--muted)]"}`}>
        {row.predictedNextDate ? (
          <>
            {format(parseISO(row.predictedNextDate), "MMM d")}
            {late > 0 && ` · ${late}d late`}
          </>
        ) : (
          "No date"
        )}
      </span>
      <span className={`mono text-right ${income ? "text-[var(--jade)]" : ""}`}>
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
        className={`shrink-0 cursor-pointer transition-colors ${
          needsName
            ? "min-h-8 rounded-full border border-[var(--brass-dim)] px-3 text-xs text-[var(--brass)] hover:bg-[var(--panel-2)]"
            : "grid h-9 w-9 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
        }`}
        aria-label="Rename this stream"
      >
        {needsName ? "Name it" : <Pencil size={13} aria-hidden />}
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

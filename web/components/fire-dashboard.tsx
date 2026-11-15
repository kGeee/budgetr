"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Mark, SectionHead, Stat, StatStrip, Verdict } from "@/components/ui/statement";
import { FireProjectionChart } from "@/components/charts";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";
import type { FireMetrics, FireProjectionPoint, MilestoneProgress } from "@/lib/fire";
import { yearsFigure } from "@/lib/plan-verdict";
import { fireVerdict } from "@/lib/progress-verdict";
import {
  addMilestone,
  deleteMilestone,
  updateFireSettings,
  updateMilestone,
} from "@/lib/actions-fire";

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

const pct1 = (v: number) => `${(v * 100).toFixed(v * 100 >= 99.5 || v === 0 ? 0 : 1)}%`;

function formatDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "February 2042" — a projection date is a month, not a day. */
function formatMonth(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ── Form primitives (mirrors savings-goals.tsx) ───────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  mono,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`h-9 w-full rounded-md border border-line bg-[var(--ink)] px-2.5 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--brass-dim)] ${
        mono ? "mono" : ""
      }`}
    />
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function FireDashboard({
  metrics,
  projection,
}: {
  metrics: FireMetrics;
  projection: FireProjectionPoint[];
}) {
  const {
    netWorth,
    savingsRate,
    runwayMonths,
    annualExpenses,
    annualExpensesDerived,
    fireNumber,
    fireProgress,
    monthlyContribution,
    monthlyContributionDerived,
    yearsToFire,
    coastFireDate,
    settings,
    milestones,
  } = metrics;

  const runwayLabel =
    runwayMonths == null
      ? "—"
      : runwayMonths >= 24
        ? `${(runwayMonths / 12).toFixed(1)} yrs`
        : `${runwayMonths.toFixed(1)} mo`;

  const verdict = fireVerdict({ netWorth, fireNumber });
  const reached = fireProgress != null && fireProgress >= 1;
  const counting = fireNumber > 0 && !reached && yearsToFire != null && yearsToFire > 0;
  const fireYear = coastFireDate ? coastFireDate.slice(0, 4) : null;
  const pctWidth = Math.max(Math.min((fireProgress ?? 0) * 100, 100), netWorth > 0 ? 2 : 0);

  return (
    <div className="space-y-9">
      {/* The long run's one figure is how far away independence is; the
          sentence says what it assumes, the bar reads net worth against the
          FIRE number, and the projection it comes from sits beside it. */}
      <section
        className="flex flex-wrap items-stretch gap-10"
        aria-label="Progress to financial independence"
      >
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3.5">
          <p className="eyebrow">Coast-FIRE</p>
          <p className="display-1 font-display text-5xl tabular sm:text-6xl">
            {counting ? (
              <>
                {yearsFigure(yearsToFire!)}{" "}
                <span className="text-[0.45em] tracking-normal text-[var(--muted)]">
                  {yearsToFire === 1 ? "year" : "years"}
                </span>
              </>
            ) : reached ? (
              <span className="text-[var(--jade)]">Reached</span>
            ) : fireNumber > 0 ? (
              <span className="text-[var(--muted)]">Never</span>
            ) : (
              <span className="text-[var(--muted)]">—</span>
            )}
          </p>
          <Verdict>
            {counting ? (
              <>
                At {formatCurrency(monthlyContribution)} a month
                {monthlyContributionDerived ? " (est.)" : ""} and a {settings.expectedReturn}% return
                you reach <Mark tone="brass">{formatCompactCurrency(fireNumber)}</Mark>
                {coastFireDate ? ` around ${formatMonth(coastFireDate)}` : ""}.
              </>
            ) : verdict && reached ? (
              <>
                {verdict.lead} <Mark tone={verdict.tone}>{formatCurrency(verdict.amount)}</Mark>{" "}
                {verdict.tail}
              </>
            ) : fireNumber > 0 ? (
              <>
                At {formatCurrency(monthlyContribution)} a month
                {monthlyContributionDerived ? " (est.)" : ""} and a {settings.expectedReturn}% return
                the projection never reaches{" "}
                <Mark tone="brass">{formatCompactCurrency(fireNumber)}</Mark>. Adjust your
                assumptions.
              </>
            ) : (
              <span className="text-[var(--muted)]">
                Set your annual expenses to compute a FIRE number.
              </span>
            )}
          </Verdict>
          {verdict && !reached && (
            <p className="text-[13px] text-[var(--muted)]">
              {verdict.lead} <span className="mono">{formatCurrency(verdict.amount)}</span>{" "}
              {verdict.tail}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="text-[var(--muted)]">
                Progress to financial independence ·{" "}
                <span className="mono text-[var(--paper)]">{formatCurrency(netWorth)}</span>
                {fireNumber > 0 && <> of {formatCurrency(fireNumber)}</>}
              </span>
              {fireProgress != null && (
                <span className="mono text-[var(--brass)]">{pct1(fireProgress)}</span>
              )}
            </div>
            <div
              role="img"
              aria-label={
                fireNumber > 0 && fireProgress != null
                  ? `${formatCurrency(netWorth)} of ${formatCurrency(fireNumber)}, ${pct1(fireProgress)}`
                  : `${formatCurrency(netWorth)} net worth`
              }
              className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]"
            >
              <div
                className={`h-full rounded-full transition-all ${reached ? "bg-[var(--jade)]" : "bg-[var(--brass)]"}`}
                style={{ width: `${pctWidth}%` }}
              />
            </div>
          </div>
          <StatStrip className="mt-auto">
            <Stat
              label="FIRE number"
              value={fireNumber > 0 ? formatCompactCurrency(fireNumber) : "—"}
              sub={`${settings.safeWithdrawalRate}% withdrawal · ${
                annualExpensesDerived ? "est. " : ""
              }${formatCompactCurrency(annualExpenses)}/yr`}
            />
            <Stat
              label="Savings rate"
              value={savingsRate == null ? "—" : pct1(savingsRate)}
              sub="of income kept, last 6 mo"
              tone={savingsRate != null && savingsRate >= 0.2 ? "jade" : "default"}
            />
            <Stat label="Runway" value={runwayLabel} sub="liquid assets ÷ expenses" />
          </StatStrip>
        </div>

        <div className="flex min-w-0 flex-[1.4_1_420px] flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow">Net-worth projection</h2>
            <span className="flex flex-wrap gap-4 text-xs text-[var(--muted)]">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-0.5 w-3.5 bg-[var(--jade)]" />
                Net worth
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="w-3.5 border-t-2 border-dashed border-[var(--brass)]" />
                Projected
              </span>
              {fireNumber > 0 && (
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="w-3.5 border-t-2 border-dashed border-[var(--jade)]" />
                  FIRE number
                </span>
              )}
            </span>
          </div>
          <FireProjectionChart data={projection} fireNumber={fireNumber} />
          {counting && fireYear && (
            <p className="mono flex justify-between text-[11px] text-[var(--muted)]">
              <span className="text-[var(--paper)]">Today</span>
              <span className="text-[var(--brass)]">FIRE, {fireYear}</span>
            </p>
          )}
        </div>
      </section>

      {/* Assumptions + milestones */}
      <div className="flex flex-wrap gap-x-12 gap-y-9">
        <div className="min-w-0 flex-[2_1_340px]">
          <SettingsForm settings={settings} metrics={metrics} />
        </div>
        <div className="min-w-0 flex-[3_1_460px]">
          <Milestones milestones={milestones} netWorth={netWorth} />
        </div>
      </div>
    </div>
  );
}

// ── Editable assumptions ──────────────────────────────────────────────────────

function SettingsForm({
  settings,
  metrics,
}: {
  settings: FireMetrics["settings"];
  metrics: FireMetrics;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [annualExpenses, setAnnualExpenses] = useState(
    settings.annualExpenses != null ? String(settings.annualExpenses) : "",
  );
  const [swr, setSwr] = useState(String(settings.safeWithdrawalRate));
  const [ret, setRet] = useState(String(settings.expectedReturn));
  const [contribution, setContribution] = useState(
    settings.monthlyContribution != null ? String(settings.monthlyContribution) : "",
  );
  const [age, setAge] = useState(
    settings.targetRetirementAge != null ? String(settings.targetRetirementAge) : "",
  );

  function save() {
    start(async () => {
      await updateFireSettings({
        annualExpenses: annualExpenses.trim() === "" ? null : num(annualExpenses),
        safeWithdrawalRate: num(swr) ?? settings.safeWithdrawalRate,
        expectedReturn: num(ret) ?? settings.expectedReturn,
        monthlyContribution: contribution.trim() === "" ? null : num(contribution),
        targetRetirementAge: age.trim() === "" ? null : num(age),
      });
      router.refresh();
    });
  }

  return (
    <section aria-label="Assumptions">
      <SectionHead title="Assumptions" />
      <AssumptionRow
        id="fire-expenses"
        label="Annual expenses"
        hint={
          metrics.annualExpensesDerived
            ? `Blank → estimated ${formatCompactCurrency(metrics.annualExpenses)} from cashflow`
            : "The spending your nest egg must cover each year"
        }
        value={annualExpenses}
        onChange={setAnnualExpenses}
        placeholder="60000"
      />
      <AssumptionRow
        id="fire-swr"
        label="Withdrawal rate %"
        hint="Sets the FIRE number: expenses ÷ rate. 4% rule by default"
        value={swr}
        onChange={setSwr}
        placeholder="4"
      />
      <AssumptionRow
        id="fire-return"
        label="Expected return %"
        hint="Nominal yearly growth used in the projection"
        value={ret}
        onChange={setRet}
        placeholder="7"
      />
      <AssumptionRow
        id="fire-contrib"
        label="Monthly contribution"
        hint={
          metrics.monthlyContributionDerived
            ? `Blank → estimated ${formatCompactCurrency(metrics.monthlyContribution)} from savings`
            : "Invested toward FIRE each month"
        }
        value={contribution}
        onChange={setContribution}
        placeholder="2000"
      />
      <AssumptionRow
        id="fire-age"
        label="Target retirement age (opt)"
        hint="Leave empty to project without one"
        value={age}
        onChange={setAge}
        placeholder="50"
      />
      <div className="flex justify-end pt-3.5">
        <Button size="md" variant="primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save assumptions"}
        </Button>
      </div>
    </section>
  );
}

/** One assumption on a ruled row: what it is and what it does, then its field. */
function AssumptionRow({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-4 border-b border-line py-2">
      <label htmlFor={id} className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-[var(--muted)]">{hint}</span>
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mono h-10 w-[120px] shrink-0 rounded-xl border border-line bg-[var(--ink)] px-3 text-right text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--brass-dim)]"
      />
    </div>
  );
}

// ── Milestones ────────────────────────────────────────────────────────────────

function Milestones({
  milestones,
  netWorth,
}: {
  milestones: MilestoneProgress[];
  netWorth: number;
}) {
  return (
    <section aria-label="Net-worth milestones">
      <SectionHead
        title="Net-worth milestones"
        count={milestones.length > 0 ? milestones.length : undefined}
        action={<AddMilestoneButton />}
      />

      {milestones.length === 0 ? (
        <div className="border-b border-dashed border-line px-6 py-12 text-center">
          <Target size={26} className="mx-auto text-[var(--muted)]" aria-hidden />
          <p className="mt-3 text-sm text-[var(--muted)]">No milestones yet.</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Add targets like &ldquo;First $100k&rdquo; to track the climb.
          </p>
        </div>
      ) : (
        <ul>
          {milestones.map((m) => (
            <MilestoneRow key={m.id} milestone={m} netWorth={netWorth} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-[13px] text-[var(--muted)]">
        A new milestone takes a label and a net-worth target. Progress is read against live net
        worth; marking one achieved stamps today&rsquo;s date on it.
      </p>
    </section>
  );
}

const ICON_BTN =
  "grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] disabled:opacity-40";

function MilestoneRow({
  milestone: m,
  netWorth,
}: {
  milestone: MilestoneProgress;
  netWorth: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const achieved = m.reached || !!m.achievedDate;

  function toggleAchieved() {
    start(async () => {
      await updateMilestone(m.id, {
        achievedDate: m.achievedDate ? null : new Date().toISOString().slice(0, 10),
      });
      router.refresh();
    });
  }

  function remove() {
    if (!confirm(`Delete milestone "${m.label}"?`)) return;
    start(async () => {
      await deleteMilestone(m.id);
      router.refresh();
    });
  }

  return (
    <li className="flex min-h-[60px] flex-wrap items-center gap-x-4 gap-y-1 border-b border-line py-1.5">
      <span
        aria-hidden
        className={`h-[9px] w-[9px] shrink-0 rounded-full border ${
          achieved
            ? "border-[var(--jade)] bg-[var(--jade)]"
            : "border-[var(--line-strong)] bg-transparent"
        }`}
      />
      <span className="min-w-0 flex-[1_1_140px]">
        <span className="block truncate font-medium">{m.label}</span>
        {/* The climb toward it, kept from the old tile: how far, and what's left. */}
        <span className="mt-1.5 flex items-center gap-2">
          <span className="h-1 max-w-[180px] flex-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
            <span
              className={`block h-full rounded-full transition-all ${achieved ? "bg-[var(--jade)]" : "bg-[var(--brass)]"}`}
              style={{ width: `${Math.max(m.pct, netWorth > 0 ? 2 : 0)}%` }}
            />
          </span>
          <span className="mono text-[11px] text-[var(--muted)]">
            {Math.round(m.pct)}%
            {!m.reached && ` · ${formatCurrency(Math.max(0, m.amount - netWorth))} to go`}
          </span>
        </span>
      </span>
      <span className="mono w-[110px] text-right">
        {formatCurrency(m.amount, undefined, { maximumFractionDigits: 0 })}
      </span>
      <span className={`w-[92px] text-xs ${achieved ? "text-[var(--jade)]" : "text-[var(--muted)]"}`}>
        {m.achievedDate ? formatDate(m.achievedDate) : m.reached ? "Reached" : "Not yet"}
      </span>
      <span className="flex items-center">
        <button
          type="button"
          onClick={toggleAchieved}
          disabled={pending}
          className="mr-1 inline-flex min-h-9 w-[132px] cursor-pointer items-center justify-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3.5 text-[13px] transition-colors hover:bg-[var(--panel-2)] disabled:opacity-40"
        >
          {!m.achievedDate && <Check size={13} aria-hidden />}
          {m.achievedDate ? "Unmark" : "Mark achieved"}
        </button>
        <EditMilestoneButton milestone={m} />
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label={`Delete ${m.label}`}
          title="Delete milestone"
          className={`${ICON_BTN} hover:text-[var(--coral)]`}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </span>
    </li>
  );
}

function AddMilestoneButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setLabel("");
    setAmount("");
  }

  const valid = label.trim() !== "" && num(amount) != null && num(amount)! > 0;

  function submit() {
    if (!valid) return;
    start(async () => {
      await addMilestone({ label: label.trim(), amount: num(amount)! });
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} className="text-[var(--brass)]">
        <Plus size={14} /> New milestone
      </Button>

      {open && (
        <Dialog onClose={close} label="New milestone">
          <DialogHeader
            title="New milestone"
            description="A net-worth target to celebrate along the way."
            onClose={close}
          />
          <DialogBody className="space-y-3">
            <Field label="Label">
              <Input value={label} onChange={setLabel} placeholder="First $100k" />
            </Field>
            <Field label="Net-worth target">
              <Input value={amount} onChange={setAmount} placeholder="100000" mono />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={submit} disabled={!valid || pending}>
              Add milestone
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}

function EditMilestoneButton({ milestone: m }: { milestone: MilestoneProgress }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(m.label);
  const [amount, setAmount] = useState(String(m.amount));
  const [pending, start] = useTransition();

  const valid = label.trim() !== "" && num(amount) != null && num(amount)! > 0;

  function save() {
    if (!valid) return;
    start(async () => {
      await updateMilestone(m.id, { label: label.trim(), amount: num(amount)! });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Edit ${m.label}`}
        title="Edit milestone"
        className={`${ICON_BTN} hover:text-[var(--paper)]`}
      >
        <Pencil size={15} aria-hidden />
      </button>

      {open && (
        <Dialog onClose={() => setOpen(false)} label="Edit milestone">
          <DialogHeader title="Edit milestone" onClose={() => setOpen(false)} />
          <DialogBody className="space-y-3">
            <Field label="Label">
              <Input value={label} onChange={setLabel} />
            </Field>
            <Field label="Net-worth target">
              <Input value={amount} onChange={setAmount} mono />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={save} disabled={!valid || pending}>
              Save
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}

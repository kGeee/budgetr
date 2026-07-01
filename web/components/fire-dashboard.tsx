"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Flame,
  Pencil,
  PiggyBank,
  Plus,
  Sparkles,
  Target,
  Timer,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FireProjectionChart } from "@/components/charts";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";
import type { FireMetrics, FireProjectionPoint, MilestoneProgress } from "@/lib/fire";
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

/** Human "X years, Y months" from a fractional-years figure. */
function formatDuration(years: number | null): string {
  if (years == null) return "Never at this rate";
  if (years <= 0) return "Reached";
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  const parts: string[] = [];
  if (whole > 0) parts.push(`${whole} yr${whole === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${months} mo`);
  return parts.join(" ") || "< 1 mo";
}

// ── Reusable primitives (mirrors savings-goals.tsx) ───────────────────────────

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)] shadow-[var(--elev-3)]">
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-[var(--faint)]">{hint}</span>}
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
      className={`h-9 w-full rounded-md border border-line bg-[var(--ink)] px-2.5 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[var(--brass-dim)] ${
        mono ? "mono" : ""
      }`}
    />
  );
}

// ── Stat tiles ────────────────────────────────────────────────────────────────

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent = "var(--paper)",
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-[var(--muted)]">
        <Icon size={15} />
        <p className="eyebrow">{label}</p>
      </div>
      <p className="mt-3 font-display text-3xl leading-none tabular" style={{ color: accent }}>
        {value}
      </p>
      {sub && <p className="mt-2 text-xs text-[var(--muted)]">{sub}</p>}
    </Card>
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

  return (
    <div className="space-y-7">
      {/* Top stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={PiggyBank}
          label="Savings rate"
          value={savingsRate == null ? "—" : pct1(savingsRate)}
          sub="of income kept, last 6 mo"
          accent={savingsRate != null && savingsRate >= 0.2 ? "var(--jade)" : "var(--paper)"}
        />
        <Stat
          icon={Timer}
          label="Runway"
          value={runwayLabel}
          sub="liquid assets ÷ expenses"
        />
        <Stat
          icon={Flame}
          label="Coast-FIRE"
          value={formatDuration(yearsToFire)}
          sub={coastFireDate ? `~ ${formatDate(coastFireDate)}` : "adjust your assumptions"}
          accent="var(--brass)"
        />
        <Stat
          icon={Target}
          label="FIRE number"
          value={fireNumber > 0 ? formatCompactCurrency(fireNumber) : "—"}
          sub={`${settings.safeWithdrawalRate}% withdrawal · ${
            annualExpensesDerived ? "est. " : ""
          }${formatCompactCurrency(annualExpenses)}/yr`}
        />
      </div>

      {/* FIRE progress bar */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Progress to financial independence</p>
            <p className="mt-2 font-display text-4xl leading-none tabular">
              {formatCurrency(netWorth)}
              {fireNumber > 0 && (
                <span className="ml-1.5 text-base text-[var(--muted)]">
                  / {formatCurrency(fireNumber)}
                </span>
              )}
            </p>
          </div>
          {fireProgress != null && (
            <p className="font-display text-2xl tabular text-[var(--brass)]">
              {pct1(fireProgress)}
            </p>
          )}
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--brass)] to-[var(--jade)] transition-all"
            style={{ width: `${Math.max((fireProgress ?? 0) * 100, netWorth > 0 ? 2 : 0)}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          {fireNumber <= 0
            ? "Set your annual expenses to compute a FIRE number."
            : fireProgress != null && fireProgress >= 1
              ? "You've hit your FIRE number — congratulations."
              : `Contributing ${formatCurrency(monthlyContribution)}/mo${
                  monthlyContributionDerived ? " (est.)" : ""
                }, growing at ${settings.expectedReturn}% — about ${formatDuration(
                  yearsToFire,
                )} to go.`}
        </p>
      </Card>

      {/* Projection chart */}
      <Card>
        <div className="mb-5 flex items-center gap-2">
          <TrendingUp size={16} className="text-[var(--brass)]" />
          <p className="eyebrow">Net-worth projection</p>
        </div>
        <FireProjectionChart data={projection} fireNumber={fireNumber} />
      </Card>

      {/* Assumptions + milestones */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SettingsForm settings={settings} metrics={metrics} />
        </div>
        <div className="lg:col-span-3">
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
    <Card className="h-full">
      <div className="mb-5 flex items-center gap-2">
        <Sparkles size={16} className="text-[var(--brass)]" />
        <p className="eyebrow">Assumptions</p>
      </div>
      <div className="space-y-3">
        <Field
          label="Annual expenses"
          hint={
            metrics.annualExpensesDerived
              ? `Blank → estimated ${formatCompactCurrency(metrics.annualExpenses)} from cashflow`
              : "The spending your nest egg must cover each year"
          }
        >
          <Input value={annualExpenses} onChange={setAnnualExpenses} placeholder="60000" mono />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Withdrawal rate %" hint="4% rule by default">
            <Input value={swr} onChange={setSwr} placeholder="4" mono />
          </Field>
          <Field label="Expected return %" hint="nominal annual">
            <Input value={ret} onChange={setRet} placeholder="7" mono />
          </Field>
        </div>
        <Field
          label="Monthly contribution"
          hint={
            metrics.monthlyContributionDerived
              ? `Blank → estimated ${formatCompactCurrency(metrics.monthlyContribution)} from savings`
              : "Invested toward FIRE each month"
          }
        >
          <Input value={contribution} onChange={setContribution} placeholder="2000" mono />
        </Field>
        <Field label="Target retirement age (opt)">
          <Input value={age} onChange={setAge} placeholder="50" mono />
        </Field>
      </div>
      <div className="mt-5">
        <Button size="sm" variant="primary" onClick={save} disabled={pending} className="w-full">
          {pending ? "Saving…" : "Save assumptions"}
        </Button>
      </div>
    </Card>
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
    <Card className="h-full">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-[var(--brass)]" />
          <p className="eyebrow">Net-worth milestones</p>
        </div>
        <AddMilestoneButton />
      </div>

      {milestones.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-line px-6 py-12 text-center">
          <Target size={26} className="mx-auto text-[var(--faint)]" />
          <p className="mt-3 text-sm text-[var(--muted)]">No milestones yet.</p>
          <p className="mt-1 text-xs text-[var(--faint)]">
            Add targets like &ldquo;First $100k&rdquo; to track the climb.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {milestones.map((m) => (
            <MilestoneRow key={m.id} milestone={m} netWorth={netWorth} />
          ))}
        </ul>
      )}
    </Card>
  );
}

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
    <li className="group">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{m.label}</span>
          {achieved && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--jade)_45%,var(--line))] bg-[color-mix(in_srgb,var(--jade)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--jade)]">
              <Check size={10} strokeWidth={3} />
              {m.achievedDate ? formatDate(m.achievedDate) : "Reached"}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="mono text-xs text-[var(--muted)]">{formatCompactCurrency(m.amount)}</span>
          <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
            <EditMilestoneButton milestone={m} />
            <button
              onClick={toggleAchieved}
              disabled={pending}
              aria-label={m.achievedDate ? "Unmark achieved" : "Mark achieved"}
              title={m.achievedDate ? "Unmark achieved" : "Mark achieved"}
              className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--jade)] disabled:opacity-40"
            >
              <Check size={13} />
            </button>
            <button
              onClick={remove}
              disabled={pending}
              aria-label={`Delete ${m.label}`}
              title="Delete milestone"
              className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--coral)] disabled:opacity-40"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
        <div
          className={`h-full rounded-full transition-all ${achieved ? "bg-[var(--jade)]" : "bg-[var(--brass)]"}`}
          style={{ width: `${Math.max(m.pct, netWorth > 0 ? 2 : 0)}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--muted)]">
        <span className="mono">{Math.round(m.pct)}%</span>
        <span className="mono">
          {m.reached ? "Cleared" : `${formatCurrency(Math.max(0, m.amount - netWorth))} to go`}
        </span>
      </div>
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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus size={14} /> Milestone
      </Button>

      {open && (
        <Modal onClose={close}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">New milestone</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              A net-worth target to celebrate along the way.
            </p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Label">
              <Input value={label} onChange={setLabel} placeholder="First $100k" />
            </Field>
            <Field label="Net-worth target">
              <Input value={amount} onChange={setAmount} placeholder="100000" mono />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={close} className="text-xs text-[var(--muted)] hover:text-[var(--paper)]">
              Cancel
            </button>
            <Button size="sm" variant="primary" onClick={submit} disabled={!valid || pending}>
              Add milestone
            </Button>
          </div>
        </Modal>
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
        className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--brass)]"
      >
        <Pencil size={13} />
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">Edit milestone</p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Label">
              <Input value={label} onChange={setLabel} />
            </Field>
            <Field label="Net-worth target">
              <Input value={amount} onChange={setAmount} mono />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-[var(--muted)] hover:text-[var(--paper)]"
            >
              Cancel
            </button>
            <Button size="sm" variant="primary" onClick={save} disabled={!valid || pending}>
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

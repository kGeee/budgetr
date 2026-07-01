"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Car,
  ChevronDown,
  GraduationCap,
  Heart,
  Home,
  Landmark,
  Laptop,
  Minus,
  Pencil,
  PiggyBank,
  Plane,
  Plus,
  ShieldCheck,
  Trash2,
  Umbrella,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { SavingsGoalRow } from "@/lib/queries";
import type { SavingsContribution } from "@/db/schema";
import {
  archiveSavingsGoal,
  contributeToGoal,
  createSavingsGoal,
  deleteContribution,
  deleteSavingsGoal,
  listGoalContributions,
  unarchiveSavingsGoal,
  updateSavingsGoal,
  withdrawFromGoal,
} from "@/lib/actions-savings";

/** Registry for goal icons stored as lucide names in the DB. */
const ICONS: Record<string, LucideIcon> = {
  PiggyBank,
  Plane,
  Home,
  Car,
  ShieldCheck,
  Umbrella,
  GraduationCap,
  Laptop,
  Heart,
  Briefcase,
  Landmark,
};
const ICON_NAMES = Object.keys(ICONS);

function GoalIcon({ icon, size = 15 }: { icon: string | null | undefined; size?: number }) {
  const Icon = (icon && ICONS[icon]) || PiggyBank;
  return <Icon size={size} />;
}

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

/** True when a goal is still short and its target date has already passed. */
function isBehind(goal: SavingsGoalRow): boolean {
  if (!goal.targetDate) return false;
  if (goal.saved >= goal.targetAmount) return false;
  return goal.targetDate < new Date().toISOString().slice(0, 10);
}

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

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ICON_NAMES.map((name) => {
        const Icon = ICONS[name];
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            aria-label={name}
            aria-pressed={active}
            className={`grid h-8 w-8 place-items-center rounded-lg border transition-colors ${
              active
                ? "border-[var(--brass)] bg-[var(--panel-2)] text-[var(--brass)]"
                : "border-line text-[var(--muted)] hover:text-[var(--paper)]"
            }`}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

export function SavingsGoals({ goals }: { goals: SavingsGoalRow[] }) {
  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);
  const [showArchived, setShowArchived] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow">
          {active.length} active goal{active.length === 1 ? "" : "s"}
        </p>
        <AddGoalButton />
      </div>

      {active.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-line bg-[var(--panel)] px-6 py-16 text-center">
          <PiggyBank size={28} className="mx-auto text-[var(--faint)]" />
          <p className="mt-3 text-sm text-[var(--muted)]">No savings goals yet.</p>
          <p className="mt-1 text-xs text-[var(--faint)]">
            Earmark money toward a vacation, an emergency fund, or your next big purchase.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((g) => (
            <GoalTile key={g.id} goal={g} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--paper)]"
          >
            <ChevronDown size={14} className={`transition-transform ${showArchived ? "rotate-180" : ""}`} />
            {archived.length} archived goal{archived.length === 1 ? "" : "s"}
          </button>
          {showArchived && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {archived.map((g) => (
                <GoalTile key={g.id} goal={g} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GoalTile({ goal }: { goal: SavingsGoalRow }) {
  const behind = isBehind(goal);
  const funded = goal.saved >= goal.targetAmount && goal.targetAmount > 0;
  const accent = goal.color || undefined;

  return (
    <div
      className={`flex flex-col rounded-[var(--radius)] border bg-gradient-to-b from-[var(--panel-2)] to-[var(--panel)] p-5 shadow-[var(--elev-2)] ${
        goal.archived ? "opacity-70" : ""
      } ${behind ? "border-[color-mix(in_srgb,var(--coral)_45%,var(--line))]" : "border-line"}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-[var(--panel-2)]"
            style={{ color: accent ?? "var(--brass)" }}
          >
            <GoalIcon icon={goal.icon} size={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{goal.name}</p>
            {goal.targetDate && (
              <p className={`text-xs ${behind ? "text-[var(--coral)]" : "text-[var(--muted)]"}`}>
                {behind ? "Past due · " : "by "}
                {formatDate(goal.targetDate)}
              </p>
            )}
          </div>
        </div>
        <GoalMenu goal={goal} />
      </div>

      {/* Amounts */}
      <div className="mt-4">
        <p className="font-display text-2xl leading-none tabular">
          {formatCurrency(goal.saved)}
          <span className="ml-1 text-sm text-[var(--muted)]">/ {formatCurrency(goal.targetAmount)}</span>
        </p>
      </div>

      {/* Progress bar — reuses the BudgetBar visual pattern. */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
        <div
          className={`h-full rounded-full transition-all ${behind ? "bg-[var(--coral)]" : "bg-[var(--jade)]"}`}
          style={{ width: `${Math.max(goal.pct, goal.saved > 0 ? 2 : 0)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className={`mono ${behind ? "text-[var(--coral)]" : "text-[var(--muted)]"}`}>
          {Math.round(goal.pct)}%
        </span>
        <span className="mono text-[var(--muted)]">
          {funded ? "Funded" : `${formatCurrency(goal.remaining)} to go`}
        </span>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <ContributeButton goal={goal} kind="deposit" />
        <ContributeButton goal={goal} kind="withdraw" />
      </div>

      <LedgerHistory goalId={goal.id} />
    </div>
  );
}

function GoalMenu({ goal }: { goal: SavingsGoalRow }) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <EditGoalButton goal={goal} />
      <ArchiveButton goal={goal} />
      <DeleteButton goal={goal} />
    </div>
  );
}

function ContributeButton({ goal, kind }: { goal: SavingsGoalRow; kind: "deposit" | "withdraw" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const isDeposit = kind === "deposit";
  const max = goal.saved; // can't withdraw more than what's saved

  function close() {
    setOpen(false);
    setAmount("");
    setNote("");
  }

  const value = num(amount);
  const valid =
    value != null && value > 0 && (isDeposit || value <= max + 0.0001);

  function submit() {
    if (!valid || value == null) return;
    start(async () => {
      if (isDeposit) await contributeToGoal(goal.id, value, note);
      else await withdrawFromGoal(goal.id, value, note);
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={isDeposit ? "primary" : "secondary"}
        className="flex-1"
        onClick={() => setOpen(true)}
        disabled={!isDeposit && max <= 0}
      >
        {isDeposit ? <Plus size={14} /> : <Minus size={14} />}
        {isDeposit ? "Add" : "Withdraw"}
      </Button>

      {open && (
        <Modal onClose={close}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">
              {isDeposit ? "Add to" : "Withdraw from"} {goal.name}
            </p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {formatCurrency(goal.saved)} saved of {formatCurrency(goal.targetAmount)}
            </p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Amount" hint={isDeposit ? undefined : `Up to ${formatCurrency(max)} available`}>
              <Input value={amount} onChange={setAmount} placeholder="100" mono />
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={setNote} placeholder={isDeposit ? "Tax refund" : "Rebooked flights"} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={close} className="text-xs text-[var(--muted)] hover:text-[var(--paper)]">
              Cancel
            </button>
            <Button
              size="sm"
              variant={isDeposit ? "primary" : "secondary"}
              onClick={submit}
              disabled={!valid || pending}
            >
              {isDeposit ? "Add" : "Withdraw"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function LedgerHistory({ goalId }: { goalId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SavingsContribution[] | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows == null) {
      start(async () => setRows(await listGoalContributions(goalId)));
    }
  }

  function remove(id: string) {
    start(async () => {
      await deleteContribution(id);
      setRows(await listGoalContributions(goalId));
      router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t border-line pt-2">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--paper)]"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        History
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {rows == null ? (
            <p className="py-2 text-xs text-[var(--faint)]">{pending ? "Loading…" : ""}</p>
          ) : rows.length === 0 ? (
            <p className="py-2 text-xs text-[var(--faint)]">No contributions yet.</p>
          ) : (
            rows.map((r) => {
              const deposit = r.amount >= 0;
              return (
                <div key={r.id} className="group flex items-center justify-between gap-2 py-0.5 text-xs">
                  <span className="min-w-0 truncate text-[var(--muted)]">
                    {formatDate(r.date)}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`mono ${deposit ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}>
                      {deposit ? "+" : "−"}
                      {formatCurrency(Math.abs(r.amount))}
                    </span>
                    <button
                      onClick={() => remove(r.id)}
                      disabled={pending}
                      aria-label="Delete entry"
                      className="rounded p-0.5 text-[var(--faint)] opacity-0 transition hover:text-[var(--coral)] group-hover:opacity-100 disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function AddGoalButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string>("PiggyBank");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState("");
  const [pending, start] = useTransition();

  function close() {
    setOpen(false);
    setName("");
    setIcon("PiggyBank");
    setTarget("");
    setDate("");
  }

  const valid = name.trim() !== "" && num(target) != null && num(target)! > 0;

  function submit() {
    if (!valid) return;
    start(async () => {
      await createSavingsGoal({
        name: name.trim(),
        targetAmount: num(target)!,
        icon,
        targetDate: date || null,
      });
      close();
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus size={14} /> New goal
      </Button>

      {open && (
        <Modal onClose={close}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">New savings goal</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Set a target; track it with deposits and withdrawals.
            </p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Name">
              <Input value={name} onChange={setName} placeholder="Japan trip" />
            </Field>
            <Field label="Icon">
              <IconPicker value={icon} onChange={setIcon} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target amount">
                <Input value={target} onChange={setTarget} placeholder="5000" mono />
              </Field>
              <Field label="Target date (opt)">
                <Input value={date} onChange={setDate} type="date" mono />
              </Field>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            <button onClick={close} className="text-xs text-[var(--muted)] hover:text-[var(--paper)]">
              Cancel
            </button>
            <Button size="sm" variant="primary" onClick={submit} disabled={!valid || pending}>
              Create goal
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function EditGoalButton({ goal }: { goal: SavingsGoalRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(goal.name);
  const [icon, setIcon] = useState<string>(goal.icon ?? "PiggyBank");
  const [target, setTarget] = useState(String(goal.targetAmount));
  const [date, setDate] = useState(goal.targetDate ?? "");
  const [pending, start] = useTransition();

  const valid = name.trim() !== "" && num(target) != null && num(target)! > 0;

  function save() {
    if (!valid) return;
    start(async () => {
      await updateSavingsGoal(goal.id, {
        name: name.trim(),
        icon,
        targetAmount: num(target)!,
        targetDate: date || null,
      });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Edit ${goal.name}`}
        title="Edit goal"
        className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--brass)]"
      >
        <Pencil size={13} />
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-medium">Edit {goal.name}</p>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Name">
              <Input value={name} onChange={setName} />
            </Field>
            <Field label="Icon">
              <IconPicker value={icon} onChange={setIcon} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Target amount">
                <Input value={target} onChange={setTarget} mono />
              </Field>
              <Field label="Target date (opt)">
                <Input value={date} onChange={setDate} type="date" mono />
              </Field>
            </div>
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

function ArchiveButton({ goal }: { goal: SavingsGoalRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() =>
        start(async () => {
          if (goal.archived) await unarchiveSavingsGoal(goal.id);
          else await archiveSavingsGoal(goal.id);
          router.refresh();
        })
      }
      disabled={pending}
      aria-label={goal.archived ? `Restore ${goal.name}` : `Archive ${goal.name}`}
      title={goal.archived ? "Restore goal" : "Archive goal"}
      className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--paper)] disabled:opacity-40"
    >
      {goal.archived ? <ChevronDown size={13} className="rotate-180" /> : <ShieldCheck size={13} />}
    </button>
  );
}

function DeleteButton({ goal }: { goal: SavingsGoalRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function remove() {
    if (!confirm(`Delete "${goal.name}"? Its contribution history will be removed too.`)) return;
    start(async () => {
      await deleteSavingsGoal(goal.id);
      router.refresh();
    });
  }
  return (
    <button
      onClick={remove}
      disabled={pending}
      aria-label={`Delete ${goal.name}`}
      title="Delete goal"
      className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--coral)] disabled:opacity-40"
    >
      <Trash2 size={13} />
    </button>
  );
}

function formatDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

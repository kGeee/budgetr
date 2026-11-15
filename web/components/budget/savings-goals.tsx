"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Briefcase,
  Car,
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
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
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

const COLS =
  "grid grid-cols-[minmax(170px,1.2fr)_minmax(150px,1.5fr)_52px_110px_110px_110px_132px] gap-4";

/**
 * Savings goals as one ruled table — name, progress, saved, target, to go —
 * with the selected goal's add/withdraw form and contribution history in a
 * panel under it, and archived goals behind a disclosure.
 */
export function SavingsGoals({ goals }: { goals: SavingsGoalRow[] }) {
  const active = goals.filter((g) => !g.archived);
  const archived = goals.filter((g) => g.archived);
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (active.find((g) => g.id === openId) ?? null) : null;

  return (
    <div className="space-y-9">
      <section aria-label="Active goals">
        {active.length === 0 ? (
          <div className="border-y border-dashed border-line px-6 py-12 text-center">
            <PiggyBank size={26} className="mx-auto text-[var(--muted)]" aria-hidden />
            <p className="mt-3 text-sm text-[var(--muted)]">No savings goals yet.</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Earmark money toward a vacation, an emergency fund, or your next big purchase.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                <div
                  className={`${COLS} items-end border-b border-[var(--line-strong)] pb-2.5 text-xs text-[var(--muted)]`}
                >
                  <h3 className="font-display text-lg tracking-tight text-[var(--paper)]">
                    Active
                    <span className="mono ml-2 text-xs text-[var(--muted)]">{active.length}</span>
                  </h3>
                  <span>Progress</span>
                  <span />
                  <span className="text-right">Saved</span>
                  <span className="text-right">Target</span>
                  <span className="text-right">To go</span>
                  <span />
                </div>
                <ul>
                  {active.map((g) => (
                    <GoalRow
                      key={g.id}
                      goal={g}
                      open={openId === g.id}
                      onToggle={() => setOpenId(openId === g.id ? null : g.id)}
                    />
                  ))}
                </ul>
              </div>
            </div>
            {open ? (
              <GoalDetail key={open.id} goal={open} />
            ) : (
              <p className="pt-3 text-[13px] text-[var(--muted)]">
                Open a goal to add to it, withdraw from it, or see its contribution history.
              </p>
            )}
          </>
        )}
      </section>

      {archived.length > 0 && (
        <section aria-label="Archived goals">
          <div className="flex items-baseline justify-between border-b border-[var(--line-strong)] pb-1">
            <h3 className="font-display text-lg tracking-tight text-[var(--muted)]">
              {archived.length} archived goal{archived.length === 1 ? "" : "s"}
            </h3>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-expanded={showArchived}
              className="min-h-9 cursor-pointer px-3 text-[13px] text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
            >
              {showArchived ? "Hide" : "Show"}
            </button>
          </div>
          {showArchived && (
            <>
              <ul>
                {archived.map((g) => (
                  <ArchivedRow key={g.id} goal={g} />
                ))}
              </ul>
              <p className="mt-3 text-[13px] text-[var(--muted)]">
                Deleting a goal removes its contribution history too.
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** "by Mar 1, 2027", "Past due · …", "Funded" or "No target date" — and its colour. */
function dateLine(goal: SavingsGoalRow): { text: string; className: string } {
  const funded = goal.saved >= goal.targetAmount && goal.targetAmount > 0;
  if (funded) return { text: "Funded", className: "text-[var(--jade)]" };
  if (!goal.targetDate) return { text: "No target date", className: "text-[var(--muted)]" };
  return isBehind(goal)
    ? { text: `Past due · ${formatDate(goal.targetDate)}`, className: "text-[var(--coral)]" }
    : { text: `by ${formatDate(goal.targetDate)}`, className: "text-[var(--muted)]" };
}

function GoalRow({
  goal,
  open,
  onToggle,
}: {
  goal: SavingsGoalRow;
  open: boolean;
  onToggle: () => void;
}) {
  const behind = isBehind(goal);
  const funded = goal.saved >= goal.targetAmount && goal.targetAmount > 0;
  const date = dateLine(goal);

  return (
    <li
      className={`${COLS} min-h-16 items-center border-b border-line transition-colors ${
        open ? "bg-[var(--panel)]" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group flex min-w-0 cursor-pointer items-center gap-2.5 py-2 pl-1 text-left"
      >
        <span
          aria-hidden
          className="shrink-0 text-[var(--brass)]"
          style={goal.color ? { color: goal.color } : undefined}
        >
          <GoalIcon icon={goal.icon} size={15} />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium transition-colors group-hover:text-[var(--brass)]">
            {goal.name}
          </span>
          <span className={`block truncate text-xs ${date.className}`}>{date.text}</span>
        </span>
      </button>
      <span
        className="h-1 overflow-hidden rounded-full bg-[var(--panel-2)]"
        role="img"
        aria-label={`${Math.round(goal.pct)}% saved`}
      >
        <span
          className={`block h-full rounded-full transition-all ${behind ? "bg-[var(--coral)]" : "bg-[var(--jade)]"}`}
          style={{ width: `${Math.max(goal.pct, goal.saved > 0 ? 2 : 0)}%` }}
        />
      </span>
      <span className={`mono text-xs ${behind ? "text-[var(--coral)]" : "text-[var(--muted)]"}`}>
        {Math.round(goal.pct)}%
      </span>
      <span className="mono text-right">{formatCurrency(goal.saved)}</span>
      <span className="mono text-right text-[var(--muted)]">
        {formatCurrency(goal.targetAmount)}
      </span>
      <span className="mono text-right">{funded ? "—" : formatCurrency(goal.remaining)}</span>
      <GoalMenu goal={goal} />
    </li>
  );
}

function GoalMenu({ goal }: { goal: SavingsGoalRow }) {
  return (
    <span className="flex shrink-0 items-center justify-end">
      <EditGoalButton goal={goal} />
      <ArchiveButton goal={goal} />
      <DeleteButton goal={goal} />
    </span>
  );
}

function ArchivedRow({ goal }: { goal: SavingsGoalRow }) {
  const date = dateLine(goal);
  const funded = goal.saved >= goal.targetAmount && goal.targetAmount > 0;
  return (
    <li className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line py-3">
      <div className="min-w-0 flex-[1_1_220px]">
        <p className="truncate font-medium text-[var(--muted)]">{goal.name}</p>
        <p className={`text-xs ${date.className}`}>{date.text}</p>
      </div>
      <div className="h-1 flex-[1_1_200px] overflow-hidden rounded-full bg-[var(--panel-2)]">
        <div
          className="h-full rounded-full bg-[var(--muted)]"
          style={{ width: `${Math.max(goal.pct, goal.saved > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="mono text-[13px] text-[var(--muted)]">
        {formatCurrency(goal.saved)} of {formatCurrency(goal.targetAmount)}
        {!funded && ` · ${formatCurrency(goal.remaining)} to go`}
      </span>
      <div className="flex items-center gap-2">
        <ArchiveButton goal={goal} labelled />
        <DeleteButton goal={goal} labelled />
      </div>
    </li>
  );
}

/**
 * The open goal's panel: an add/withdraw form on the left and the contribution
 * ledger on the right. History is fetched when the panel opens and again after
 * every entry, so the two halves can't disagree.
 */
function GoalDetail({ goal }: { goal: SavingsGoalRow }) {
  const router = useRouter();
  const [kind, setKind] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<SavingsContribution[] | null>(null);
  const [pending, start] = useTransition();
  const isDeposit = kind === "deposit";
  const max = goal.saved; // can't withdraw more than what's saved

  useEffect(() => {
    let live = true;
    listGoalContributions(goal.id).then((r) => {
      if (live) setRows(r);
    });
    return () => {
      live = false;
    };
  }, [goal.id]);

  const value = num(amount);
  const valid = value != null && value > 0 && (isDeposit || value <= max + 0.0001);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || value == null) return;
    start(async () => {
      if (isDeposit) await contributeToGoal(goal.id, value, note);
      else await withdrawFromGoal(goal.id, value, note);
      setAmount("");
      setNote("");
      setRows(await listGoalContributions(goal.id));
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      await deleteContribution(id);
      setRows(await listGoalContributions(goal.id));
      router.refresh();
    });
  }

  return (
    <div
      role="region"
      aria-label={`${goal.name} detail`}
      className="flex flex-wrap gap-x-12 gap-y-8 rounded-b-[var(--radius)] border border-t-0 border-[var(--line-strong)] bg-[var(--panel)] p-5"
    >
      <form onSubmit={submit} className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">
            {isDeposit ? "Add to" : "Withdraw from"} {goal.name}
          </span>
          <div
            role="group"
            aria-label="Direction"
            className="flex rounded-full border border-line p-[3px] text-xs"
          >
            {(["deposit", "withdraw"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                disabled={k === "withdraw" && max <= 0}
                onClick={() => setKind(k)}
                className={`min-h-8 cursor-pointer rounded-full px-3.5 transition-colors disabled:cursor-default disabled:opacity-40 ${
                  kind === k
                    ? "bg-[var(--panel-2)] text-[var(--paper)]"
                    : "text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                {k === "deposit" ? "Add" : "Withdraw"}
              </button>
            ))}
          </div>
        </div>
        <Field label="Amount">
          <Input value={amount} onChange={setAmount} placeholder="100" mono />
        </Field>
        <Field label="Note (optional)">
          <Input
            value={note}
            onChange={setNote}
            placeholder={isDeposit ? "Tax refund" : "Rebooked flights"}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-[var(--muted)]">
            Withdrawals are capped at what&rsquo;s saved: up to {formatCurrency(max)} available.
          </span>
          <Button type="submit" size="sm" variant="primary" disabled={!valid || pending}>
            {isDeposit ? "Add" : "Withdraw"}
            {valid && value != null ? ` ${formatCurrency(value)}` : ""}
          </Button>
        </div>
      </form>

      <div className="min-w-0 flex-[1.4_1_360px]">
        <div className="flex items-baseline justify-between border-b border-[var(--line-strong)] pb-2">
          <span className="eyebrow">Contribution history</span>
          <span className="mono text-xs text-[var(--muted)]">
            {formatCurrency(goal.saved)} saved
          </span>
        </div>
        {rows == null ? (
          <p className="py-3 text-[13px] text-[var(--muted)]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-[13px] text-[var(--muted)]">No contributions yet.</p>
        ) : (
          <ul>
            {rows.map((r) => {
              const deposit = r.amount >= 0;
              return (
                <li key={r.id} className="flex min-h-11 items-center gap-3.5 border-b border-line">
                  <span className="mono w-24 shrink-0 text-xs text-[var(--muted)]">
                    {formatDate(r.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{r.note ?? ""}</span>
                  <span className={`mono ${deposit ? "text-[var(--jade)]" : "text-[var(--coral)]"}`}>
                    {deposit ? "+" : "−"}
                    {formatCurrency(Math.abs(r.amount))}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    disabled={pending}
                    aria-label="Delete entry"
                    className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--coral)] disabled:opacity-40"
                  >
                    <X size={14} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Add-to / withdraw-from a goal in a dialog. The Goals table uses the inline
 * panel instead; this is for places that show a goal without its detail (the
 * Plan → This month summary).
 */
export function GoalContributeButton({ goal, kind }: { goal: SavingsGoalRow; kind: "deposit" | "withdraw" }) {
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!isDeposit && max <= 0}
        aria-label={`${isDeposit ? "Add to" : "Withdraw from"} ${goal.name}`}
        className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors disabled:cursor-default disabled:opacity-40 ${
          isDeposit
            ? "border-[var(--line-strong)] text-[var(--paper)] hover:bg-[var(--panel-2)]"
            : "border-line text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--paper)]"
        }`}
      >
        {isDeposit ? <Plus size={13} aria-hidden /> : <Minus size={13} aria-hidden />}
        {isDeposit ? "Add" : "Withdraw"}
      </button>

      {open && (
        <Dialog onClose={close} label={`${isDeposit ? "Add to" : "Withdraw from"} ${goal.name}`}>
          <DialogHeader
            title={`${isDeposit ? "Add to" : "Withdraw from"} ${goal.name}`}
            description={`${formatCurrency(goal.saved)} saved of ${formatCurrency(goal.targetAmount)}`}
            onClose={close}
          />
          <DialogBody className="space-y-3">
            <Field label="Amount" hint={isDeposit ? undefined : `Up to ${formatCurrency(max)} available`}>
              <Input value={amount} onChange={setAmount} placeholder="100" mono />
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={setNote} placeholder={isDeposit ? "Tax refund" : "Rebooked flights"} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={isDeposit ? "primary" : "secondary"}
              onClick={submit}
              disabled={!valid || pending}
            >
              {isDeposit ? "Add" : "Withdraw"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}

export function AddGoalButton() {
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
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        <Plus size={14} /> New savings goal
      </Button>

      {open && (
        <Dialog onClose={close} label="New savings goal">
          <DialogHeader
            title="New savings goal"
            description="Set a target; track it with deposits and withdrawals."
            onClose={close}
          />
          <DialogBody className="space-y-3">
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
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={submit} disabled={!valid || pending}>
              Create goal
            </Button>
          </DialogFooter>
        </Dialog>
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
        className="grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--paper)]"
      >
        <Pencil size={15} aria-hidden />
      </button>

      {open && (
        <Dialog onClose={() => setOpen(false)} label={`Edit ${goal.name}`}>
          <DialogHeader title={`Edit ${goal.name}`} onClose={() => setOpen(false)} />
          <DialogBody className="space-y-3">
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

const PILL =
  "inline-flex min-h-9 cursor-pointer items-center rounded-full border px-4 text-[13px] transition-colors disabled:cursor-default disabled:opacity-40";

function ArchiveButton({ goal, labelled = false }: { goal: SavingsGoalRow; labelled?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
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
      className={
        labelled
          ? `${PILL} border-[var(--line-strong)] text-[var(--paper)] hover:bg-[var(--panel-2)]`
          : "grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--paper)] disabled:opacity-40"
      }
    >
      {labelled ? (
        goal.archived ? "Restore" : "Archive"
      ) : goal.archived ? (
        <ArchiveRestore size={15} aria-hidden />
      ) : (
        <Archive size={15} aria-hidden />
      )}
    </button>
  );
}

function DeleteButton({ goal, labelled = false }: { goal: SavingsGoalRow; labelled?: boolean }) {
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
      type="button"
      onClick={remove}
      disabled={pending}
      aria-label={`Delete ${goal.name}`}
      title="Delete goal"
      className={
        labelled
          ? `${PILL} border-line text-[var(--coral)] hover:border-[var(--coral)]`
          : "grid h-9 w-9 cursor-pointer place-items-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)] hover:text-[var(--coral)] disabled:opacity-40"
      }
    >
      {labelled ? "Delete" : <Trash2 size={15} aria-hidden />}
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

/**
 * Bill-split arithmetic — pure, dependency-free, and safe to bundle for the
 * browser so the split modal can preview allocations as you type. The database
 * half of shared expenses lives in lib/sharing.ts, which re-exports these.
 */

// ── Share allocation ─────────────────────────────────────────────────────────

export type SplitMode = "even" | "amounts" | "percent";

export type SplitParticipant = {
  /** null = you. Exactly one participant may be null. */
  personId: string | null;
  /** "amounts" → dollars owed; "percent" → 0-100; "even" → ignored. */
  value?: number;
};

export type ComputedSplit = {
  /** Your own slice, in transactions.amount convention. */
  myShare: number;
  /** Everyone else's slice. Always sums with myShare to exactly the total. */
  shares: { personId: string; amount: number }[];
};

/**
 * The cent-allocation rule now lives in @budgetr/core, so the desktop splitter
 * and the phone round identically — two devices showing the same bill a cent
 * apart is the kind of bug nobody reports and everybody stops trusting.
 */
import { allocateCents } from "@budgetr/core";
export { allocateCents };

const toCents = (n: number) => Math.round(n * 100);

/**
 * Resolve a split into exact per-person amounts.
 *
 * `even` and `percent` allocate the whole total across every participant (you
 * included) with no cent lost. `amounts` takes the other people's figures as
 * given and leaves you the remainder, which is how you'd read a receipt.
 *
 * Returns an error string instead of throwing so callers can surface it in a
 * form; a split that doesn't reconcile is a user mistake, not an exception.
 */
export function computeSplit(
  total: number,
  mode: SplitMode,
  participants: SplitParticipant[],
): { ok: true; split: ComputedSplit } | { ok: false; error: string } {
  const others = participants.filter((p) => p.personId !== null);
  if (others.length === 0) return { ok: false, error: "Add at least one person to split with." };
  if (participants.filter((p) => p.personId === null).length > 1) {
    return { ok: false, error: "You can only appear once in a split." };
  }

  const totalCents = toCents(total);
  const sign = totalCents < 0 ? -1 : 1;
  const magnitude = Math.abs(totalCents);

  if (mode === "amounts") {
    const shares: { personId: string; amount: number }[] = [];
    let assigned = 0;
    for (const p of others) {
      const cents = toCents(Math.abs(p.value ?? 0));
      if (cents <= 0) return { ok: false, error: "Every person needs an amount above zero." };
      assigned += cents;
      shares.push({ personId: p.personId!, amount: (cents * sign) / 100 });
    }
    if (assigned > magnitude) {
      return {
        ok: false,
        error: `Shares add up to more than the ${(magnitude / 100).toFixed(2)} total.`,
      };
    }
    return { ok: true, split: { myShare: ((magnitude - assigned) * sign) / 100, shares } };
  }

  const includesMe = participants.some((p) => p.personId === null);
  const weights =
    mode === "percent"
      ? participants.map((p) => Math.max(0, p.value ?? 0))
      : participants.map(() => 1);

  if (mode === "percent") {
    const pct = weights.reduce((a, w) => a + w, 0);
    if (Math.abs(pct - 100) > 0.01) {
      return { ok: false, error: `Percentages must add up to 100 (currently ${pct.toFixed(1)}).` };
    }
  }

  const parts = allocateCents(magnitude, weights);
  const shares: { personId: string; amount: number }[] = [];
  let myCents = 0;
  participants.forEach((p, i) => {
    if (p.personId === null) myCents += parts[i];
    else shares.push({ personId: p.personId, amount: (parts[i] * sign) / 100 });
  });

  // An even split you're not part of (you paid, you ate nothing) leaves you zero.
  if (!includesMe) myCents = magnitude - parts.reduce((a, n) => a + n, 0);

  return { ok: true, split: { myShare: (myCents * sign) / 100, shares } };
}


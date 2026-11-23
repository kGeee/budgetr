export type SnapshotRow = { accountId: string; date: string; balance: number };

/**
 * Daily total across accounts from per-account balance snapshots.
 *
 * Snapshots are written per Plaid item as each item syncs, so a given day only
 * has rows for the accounts whose item synced that day. Summing each date's
 * rows directly makes the total collapse by an account's whole balance on every
 * day it happened not to sync (a $10K savings account missing on alternate days
 * drew a ±$10K sawtooth). Instead, carry each account's last known balance
 * forward until its next snapshot.
 *
 * An account is carried only through its own last snapshot date, so a closed
 * or unlinked account stops contributing rather than counting forever at a
 * stale balance.
 */
export function forwardFilledTotals(rows: SnapshotRow[]): { date: string; total: number }[] {
  const lastDate = new Map<string, string>();
  const byDate = new Map<string, SnapshotRow[]>();
  for (const r of rows) {
    const prev = lastDate.get(r.accountId);
    if (!prev || r.date > prev) lastDate.set(r.accountId, r.date);
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }

  const current = new Map<string, number>();
  const out: { date: string; total: number }[] = [];
  for (const date of [...byDate.keys()].sort()) {
    for (const r of byDate.get(date)!) current.set(r.accountId, r.balance);
    let total = 0;
    for (const [id, bal] of current) {
      total += bal;
      // Last day this account reports — drop it after this date.
      if (lastDate.get(id) === date) current.delete(id);
    }
    out.push({ date, total });
  }
  return out;
}

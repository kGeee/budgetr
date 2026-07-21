// The desktop sync engine (spec T4): pull + apply phone edits, push a fresh
// encrypted summary when anything changed, ack what was durably applied.
//
// Cadence: a 60-second tick that no-ops unless the summary content actually
// changed (deterministic buildSummary → stable hash with asOf zeroed), plus an
// immediate push after ops apply and after pairing. The spec's 2 s DB-change
// debounce would need write hooks across every action; the poll+hash approach
// gets the same relay traffic (identical state never re-uploads) at worse
// latency, which a glance app tolerates. Revisit if 60 s ever feels stale.

import { createHash } from "node:crypto";
import { assertValidOutbox, buildSummary, type OutboxBatch } from "@budgetr/core";
import { fromBase64, open, seal, type Envelope } from "@budgetr/sync-crypto";
import { buildReadModel } from "./read-model";
import { applyOps } from "./ops";
import {
  getLastPushedHash,
  getLastSeq,
  loadPairing,
  recordSyncError,
  recordSyncOk,
  setLastPushedHash,
  setLastSeq,
} from "./store";

const FETCH_TIMEOUT_MS = 10_000;
const TICK_MS = 60_000;

export interface SyncResult {
  paired: boolean;
  pushed: boolean;
  batchesApplied: number;
  error: string | null;
}

let running = false;

export async function syncNow(): Promise<SyncResult> {
  const pairing = loadPairing();
  if (!pairing) return { paired: false, pushed: false, batchesApplied: 0, error: null };
  if (running) return { paired: true, pushed: false, batchesApplied: 0, error: null };
  running = true;

  const result: SyncResult = { paired: true, pushed: false, batchesApplied: 0, error: null };
  const base = `${pairing.relayUrl.replace(/\/$/, "")}/v1/channels/${pairing.channelId}`;
  const headers = { Authorization: `Bearer ${pairing.channelToken}` };
  const key = fromBase64(pairing.syncKey);

  try {
    // ── 1. pull + apply phone edits ──────────────────────────────────
    const lastSeq = getLastSeq();
    const outboxRes = await fetch(`${base}/outbox?after=${lastSeq}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!outboxRes.ok) throw new Error(`outbox fetch failed (${outboxRes.status})`);
    const batches = (await outboxRes.json()) as Array<{ seq: number; env: Envelope }>;

    let maxSeq = lastSeq;
    let mutated = 0;
    for (const { seq, env } of batches) {
      try {
        const batch = open<OutboxBatch>(env, key);
        assertValidOutbox(batch);
        mutated += applyOps(batch.ops).mutated;
        result.batchesApplied += 1;
      } catch (err) {
        // Tampered or malformed batch: discard it (spec §5.2) but keep the
        // error visible. Acking past it prevents a poison batch from wedging
        // the queue forever; the phone will see its op ids never confirmed.
        result.error = err instanceof Error ? `bad outbox batch: ${err.name}` : "bad outbox batch";
      }
      maxSeq = Math.max(maxSeq, seq);
    }

    // ── 2. push a fresh summary when content changed (or ops landed) ──
    const summary = buildSummary(buildReadModel());
    const hash = createHash("sha256").update(JSON.stringify({ ...summary, asOf: 0 })).digest("hex");
    if (hash !== getLastPushedHash() || mutated > 0) {
      const putRes = await fetch(`${base}/summary`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(seal(summary, key)),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!putRes.ok) throw new Error(`summary push failed (${putRes.status})`);
      setLastPushedHash(hash);
      result.pushed = true;
    }

    // ── 3. ack only after apply + push both survived ─────────────────
    if (maxSeq > lastSeq) {
      const ackRes = await fetch(`${base}/outbox?through=${maxSeq}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!ackRes.ok) throw new Error(`outbox ack failed (${ackRes.status})`);
      setLastSeq(maxSeq);
    }

    if (result.error) recordSyncError(result.error);
    else recordSyncOk(summary.asOf);
  } catch (err) {
    // Non-sensitive by construction: status codes and error names only.
    result.error = err instanceof Error ? err.message : "sync failed";
    recordSyncError(result.error);
  } finally {
    running = false;
  }
  return result;
}

/** Start the background tick. Safe to call repeatedly (dev HMR, multiple imports). */
export function startCompanionEngine(): void {
  const g = globalThis as typeof globalThis & { __companionEngine?: NodeJS.Timeout };
  if (g.__companionEngine) return;
  const tick = () => void syncNow().catch(() => {});
  g.__companionEngine = setInterval(tick, TICK_MS);
  g.__companionEngine.unref?.();
  setTimeout(tick, 5_000).unref?.(); // first sync shortly after boot
}

// The phone's half of the sync protocol (spec T5):
//   1. flush the pending-op outbox (POST, Idempotency-Key = batchId)
//   2. GET the summary with If-None-Match; decrypt, validate, cache
//   3. drop pending ops the desktop confirmed via Summary.appliedOpIds
//
// Every failure maps to a state, not an exception, at the UI edge:
//   'update-required' — summary written by a newer app (ContractVersionError)
//   'tampered'        — envelope failed authentication; cache stays, error shows
//   'offline'         — network unreachable; cache stays

import {
  ContractVersionError,
  assertValidSummary,
  OUTBOX_VERSION,
  type Op,
  type Summary,
} from "@budgetr/core";
import {
  EnvelopeTamperError,
  EnvelopeVersionError,
  fromBase64,
  open,
  seal,
  type Envelope,
  type PairingMaterial,
} from "@budgetr/sync-crypto";
import { getDeviceId, loadPendingOps, savePendingOps, saveCachedSummary, touchLastSync } from "./cache";
import { uuid4 } from "./uuid";

export type SyncStatus = "ok" | "not-modified" | "update-required" | "tampered" | "offline" | "error";

export interface SyncOutcome {
  status: SyncStatus;
  summary: Summary | null; // fresh summary when status === 'ok'
  pendingOps: Op[]; // queue after confirmation pruning
  detail?: string;
}

const TIMEOUT_MS = 10_000;

function channelUrl(m: PairingMaterial, path: string): string {
  return `${m.relayUrl.replace(/\/$/, "")}/v1/channels/${m.channelId}${path}`;
}

function authHeaders(m: PairingMaterial): Record<string, string> {
  return { Authorization: `Bearer ${m.channelToken}` };
}

/** POST the whole pending queue as one batch. Safe to repeat: op ids are stable. */
async function flushOutbox(material: PairingMaterial, ops: Op[]): Promise<void> {
  if (ops.length === 0) return;
  const key = fromBase64(material.syncKey);
  const batch = {
    v: OUTBOX_VERSION,
    deviceId: await getDeviceId(),
    batchId: uuid4(),
    createdAt: Math.floor(Date.now() / 1000),
    ops,
  };
  const res = await fetch(channelUrl(material, "/outbox"), {
    method: "POST",
    headers: {
      ...authHeaders(material),
      "content-type": "application/json",
      "Idempotency-Key": batch.batchId,
    },
    body: JSON.stringify(seal(batch, key)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`outbox push failed (${res.status})`);
}

export async function syncOnce(material: PairingMaterial, etag: string | null): Promise<SyncOutcome> {
  const pendingBefore = await loadPendingOps();

  try {
    // 1. hand queued edits to the relay (desktop confirms them via appliedOpIds)
    await flushOutbox(material, pendingBefore);

    // 2. fetch the latest summary
    const res = await fetch(channelUrl(material, "/summary"), {
      headers: { ...authHeaders(material), ...(etag ? { "If-None-Match": etag } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 304) {
      await touchLastSync();
      return { status: "not-modified", summary: null, pendingOps: pendingBefore };
    }
    if (res.status === 404) {
      return { status: "error", summary: null, pendingOps: pendingBefore, detail: "Mac hasn't published a summary yet" };
    }
    if (!res.ok) {
      return { status: "error", summary: null, pendingOps: pendingBefore, detail: `relay error (${res.status})` };
    }

    const envelope = (await res.json()) as Envelope;
    const summary = open<Summary>(envelope, fromBase64(material.syncKey));
    assertValidSummary(summary);

    // 3. prune ops the desktop has durably applied
    const confirmed = new Set(summary.appliedOpIds);
    const pendingAfter = pendingBefore.filter((op) => !confirmed.has(op.id));
    if (pendingAfter.length !== pendingBefore.length) await savePendingOps(pendingAfter);

    await saveCachedSummary(summary, res.headers.get("etag"));
    return { status: "ok", summary, pendingOps: pendingAfter };
  } catch (err) {
    if (err instanceof ContractVersionError || err instanceof EnvelopeVersionError) {
      return { status: "update-required", summary: null, pendingOps: pendingBefore };
    }
    if (err instanceof EnvelopeTamperError) {
      return { status: "tampered", summary: null, pendingOps: pendingBefore, detail: "sync data failed verification" };
    }
    const offline = err instanceof TypeError || (err instanceof Error && err.name === "TimeoutError");
    return {
      status: offline ? "offline" : "error",
      summary: null,
      pendingOps: pendingBefore,
      detail: err instanceof Error ? err.message : "sync failed",
    };
  }
}

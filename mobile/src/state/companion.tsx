// App-wide companion state: pairing, the cached summary, sync status, and the
// two allowed edits (recategorize, dismissAlert) applied optimistically and
// queued in the outbox. Render-from-cache-first, refresh on foreground and on
// pull-to-refresh (spec T5).

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Op, Summary } from "@budgetr/core";
import { decodePairing, type PairingMaterial } from "@budgetr/sync-crypto";
import { clearCache, loadCachedSummary, loadPendingOps, savePendingOps } from "@/sync/cache";
import { clearMaterial, loadMaterial, saveMaterial } from "@/sync/material";
import { syncOnce, type SyncStatus } from "@/sync/client";
import { uuid4 } from "@/sync/uuid";

export type Phase = "loading" | "unpaired" | "ready" | "update-required";

interface CompanionState {
  phase: Phase;
  summary: Summary | null;
  pendingOps: Op[];
  lastSyncAt: number | null;
  syncError: string | null; // human string when the last sync failed; null = healthy
  refreshing: boolean;
  pair(qrPayload: string): Promise<string | null>; // returns error message or null
  refresh(): Promise<void>;
  recategorize(txnId: string, toCategory: string): void;
  dismissAlert(alertId: string): void;
  unpair(): Promise<void>;
}

const Ctx = createContext<CompanionState | null>(null);

export function useCompanion(): CompanionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCompanion outside provider");
  return v;
}

/** Optimistic local edit — the desktop's next summary is the real truth. */
function applyLocally(summary: Summary, op: Op): Summary {
  if (op.kind === "recategorize") {
    return {
      ...summary,
      recent: summary.recent.map((t) => (t.id === op.txnId ? { ...t, category: op.toCategory } : t)),
    };
  }
  return { ...summary, alerts: summary.alerts.filter((a) => a.id !== op.alertId) };
}

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pendingOps, setPendingOps] = useState<Op[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const material = useRef<PairingMaterial | null>(null);
  const etag = useRef<string | null>(null);
  const syncing = useRef(false);

  const absorb = useCallback((status: SyncStatus, fresh: Summary | null, ops: Op[], detail?: string) => {
    setPendingOps(ops);
    if (status === "ok" && fresh) {
      setSummary(fresh);
      setLastSyncAt(Math.floor(Date.now() / 1000));
      setSyncError(null);
    } else if (status === "not-modified") {
      setLastSyncAt(Math.floor(Date.now() / 1000));
      setSyncError(null);
    } else if (status === "update-required") {
      setPhase("update-required");
    } else if (status === "offline") {
      setSyncError("offline — showing saved data");
    } else {
      setSyncError(detail ?? "sync error — showing saved data");
    }
  }, []);

  const refresh = useCallback(async () => {
    const m = material.current;
    if (!m || syncing.current) return;
    syncing.current = true;
    setRefreshing(true);
    try {
      const r = await syncOnce(m, etag.current);
      if (r.status === "ok") {
        const cached = await loadCachedSummary();
        etag.current = cached?.etag ?? null;
      }
      absorb(r.status, r.summary, r.pendingOps, r.detail);
    } finally {
      syncing.current = false;
      setRefreshing(false);
    }
  }, [absorb]);

  // boot: load material + cache, then refresh in the background
  useEffect(() => {
    void (async () => {
      material.current = await loadMaterial();
      if (!material.current) {
        setPhase("unpaired");
        return;
      }
      const cached = await loadCachedSummary();
      if (cached) {
        setSummary(cached.summary);
        etag.current = cached.etag;
        setLastSyncAt(cached.lastSyncAt);
      }
      setPendingOps(await loadPendingOps());
      setPhase("ready");
      void refresh();
    })();
  }, [refresh]);

  // refresh whenever the app comes to the foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && phase === "ready") void refresh();
    });
    return () => sub.remove();
  }, [phase, refresh]);

  const pair = useCallback(
    async (qrPayload: string): Promise<string | null> => {
      try {
        const p = decodePairing(qrPayload.trim());
        const m: PairingMaterial = {
          relayUrl: p.relayUrl,
          channelId: p.channelId,
          channelToken: p.channelToken,
          syncKey: p.syncKey,
        };
        await saveMaterial(m);
        material.current = m;
        etag.current = null;
        setPhase("ready");
        void refresh();
        return null;
      } catch {
        return "That doesn't look like a budgetr pairing code.";
      }
    },
    [refresh],
  );

  const enqueue = useCallback(
    (op: Op) => {
      setSummary((s) => (s ? applyLocally(s, op) : s));
      setPendingOps((prev) => {
        const next = [...prev, op];
        void savePendingOps(next);
        return next;
      });
      void refresh(); // opportunistic flush; retries on next foreground if offline
    },
    [refresh],
  );

  const recategorize = useCallback(
    (txnId: string, toCategory: string) =>
      enqueue({ id: uuid4(), ts: Math.floor(Date.now() / 1000), kind: "recategorize", txnId, toCategory }),
    [enqueue],
  );

  const dismissAlert = useCallback(
    (alertId: string) =>
      enqueue({ id: uuid4(), ts: Math.floor(Date.now() / 1000), kind: "dismissAlert", alertId }),
    [enqueue],
  );

  const unpair = useCallback(async () => {
    await clearMaterial();
    await clearCache();
    material.current = null;
    etag.current = null;
    setSummary(null);
    setPendingOps([]);
    setLastSyncAt(null);
    setSyncError(null);
    setPhase("unpaired");
  }, []);

  return (
    <Ctx.Provider
      value={{ phase, summary, pendingOps, lastSyncAt, syncError, refreshing, pair, refresh, recategorize, dismissAlert, unpair }}
    >
      {children}
    </Ctx.Provider>
  );
}

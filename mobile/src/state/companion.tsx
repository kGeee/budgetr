// App-wide companion state: pairing, the cached summary, sync status, and the
// two allowed edits (recategorize, dismissAlert) applied optimistically and
// queued in the outbox. Render-from-cache-first, refresh on foreground and on
// pull-to-refresh (spec T5).

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Op, Summary } from "@budgetr/core";
import { decodePairing, type PairingMaterial } from "@budgetr/sync-crypto";
import * as haptics from "@/haptics";
import { buildDemoSummary } from "@/demo";
import { clearCache, loadCachedSummary, loadPendingOps, savePendingOps } from "@/sync/cache";
import { clearMaterial, loadMaterial, saveMaterial } from "@/sync/material";
import { syncOnce, type SyncStatus } from "@/sync/client";
import { publishWidgetData, type WidgetStatus } from "@/widget";
import { uuid4 } from "@/sync/uuid";

export type Phase = "loading" | "unpaired" | "ready" | "update-required";

interface CompanionState {
  phase: Phase;
  summary: Summary | null;
  pendingOps: Op[];
  lastSyncAt: number | null;
  syncError: string | null; // human string when the last sync failed; null = healthy
  refreshing: boolean;
  manualSyncAt: number | null; // unix seconds of the last user-initiated pull-to-refresh
  widget: WidgetStatus; // whether the Home/Lock Screen payload is actually landing
  demo: boolean; // showing fabricated data; no material, no relay, nothing persisted
  pair(qrPayload: string): Promise<string | null>; // returns error message or null
  enterDemo(): void;
  refresh(opts?: { manual?: boolean }): Promise<void>;
  recategorize(txnId: string, toCategory: string): void;
  dismissAlert(alertId: string): void;
  /** Record a bill split. `shares` are resolved cents, from the shared allocator. */
  splitBill(input: {
    txnId: string;
    shares: { personId: string; cents: number }[];
    basisCents?: number | null;
    itemsJson?: string | null;
    note?: string | null;
  }): void;
  /** "They paid me back." */
  recordSettlement(input: { personId: string; cents: number; txnId?: string | null }): void;
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
  if (op.kind === "dismissAlert") {
    return { ...summary, alerts: summary.alerts.filter((a) => a.id !== op.alertId) };
  }
  if (op.kind === "splitBill") {
    // Move the balances immediately. The desktop's next summary replaces all of
    // this — the point is only that the number you just changed doesn't sit
    // stale until the round trip finishes.
    const owed = new Map(op.shares.map((sh) => [sh.personId, sh.cents]));
    return {
      ...summary,
      people: (summary.people ?? []).map((p) =>
        owed.has(p.id) ? { ...p, cents: p.cents + owed.get(p.id)!, openCount: p.openCount + 1 } : p,
      ),
    };
  }
  if (op.kind === "recordSettlement") {
    return {
      ...summary,
      people: (summary.people ?? []).map((p) =>
        p.id === op.personId ? { ...p, cents: p.cents - op.cents } : p,
      ),
      // The suggestion has been acted on; it should not still be offered.
      settleSuggestions: (summary.settleSuggestions ?? []).filter(
        (sg) => !(sg.personId === op.personId && (op.txnId == null || sg.txnId === op.txnId)),
      ),
    };
  }
  return summary;
}

export function CompanionProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pendingOps, setPendingOps] = useState<Op[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [manualSyncAt, setManualSyncAt] = useState<number | null>(null);
  const [widget, setWidget] = useState<WidgetStatus>({ state: "unknown" });
  const [demo, setDemo] = useState(false);
  const material = useRef<PairingMaterial | null>(null);
  const etag = useRef<string | null>(null);
  const syncing = useRef(false);
  const latest = useRef<Summary | null>(null); // newest summary, for republishing on 304

  // Keep the Home/Lock Screen in lockstep. Republished on every successful
  // sync — including 304s — so a widget that lost its payload (reinstall, new
  // build, App Group reset) heals on the next foreground refresh instead of
  // waiting for the desktop to change something.
  const publish = useCallback((s: Summary | null) => {
    latest.current = s;
    if (s) setWidget(publishWidgetData(s));
  }, []);

  const absorb = useCallback(
    (status: SyncStatus, fresh: Summary | null, ops: Op[], detail?: string) => {
      setPendingOps(ops);
      if (status === "ok" && fresh) {
        setSummary(fresh);
        setLastSyncAt(Math.floor(Date.now() / 1000));
        setSyncError(null);
        publish(fresh);
      } else if (status === "not-modified") {
        setLastSyncAt(Math.floor(Date.now() / 1000));
        setSyncError(null);
        publish(latest.current);
      } else if (status === "update-required") {
        setPhase("update-required");
      } else if (status === "offline") {
        setSyncError("offline — showing saved data");
      } else {
        setSyncError(detail ?? "sync error — showing saved data");
      }
    },
    [publish],
  );

  // `manual` marks a refresh the user asked for by pulling down. Only those get
  // a "synced Xm ago" confirmation — a background sync reporting itself is noise
  // on a screen you didn't ask to update. Warnings (offline, stale, errors) are
  // unconditional either way; they're states the user needs regardless.
  const refresh = useCallback(
    async ({ manual = false }: { manual?: boolean } = {}) => {
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
        if (manual) setManualSyncAt(Math.floor(Date.now() / 1000));
      } finally {
        syncing.current = false;
        setRefreshing(false);
      }
    },
    [absorb],
  );

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
        publish(cached.summary);
      }
      setPendingOps(await loadPendingOps());
      setPhase("ready");
      void refresh();
    })();
  }, [publish, refresh]);

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
        haptics.success();
        void refresh();
        return null;
      } catch {
        haptics.error();
        return "That doesn't look like a budgetr pairing code.";
      }
    },
    [refresh],
  );

  // Sample data, for someone who has no Mac to pair with — an App Review tester,
  // or you wanting to look at a screen without waiting on a sync. Deliberately
  // writes no material and no cache: `refresh` already no-ops without material,
  // so nothing here can reach the relay, and quitting the app forgets it ever
  // happened. The widget payload IS published, so the Home Screen widgets can be
  // reviewed too; the next real sync overwrites it.
  const enterDemo = useCallback(() => {
    const fixture = buildDemoSummary();
    material.current = null;
    etag.current = null;
    setDemo(true);
    setSummary(fixture);
    setPendingOps([]);
    setLastSyncAt(Math.floor(Date.now() / 1000));
    setSyncError(null);
    publish(fixture);
    setPhase("ready");
    haptics.success();
  }, [publish]);

  const enqueue = useCallback(
    (op: Op) => {
      setSummary((s) => (s ? applyLocally(s, op) : s));
      setPendingOps((prev) => {
        const next = [...prev, op];
        // In demo there is no desktop to flush to and nothing worth surviving a
        // relaunch — keep the optimistic edit on screen, but off the disk.
        if (!demo) void savePendingOps(next);
        return next;
      });
      void refresh(); // opportunistic flush; retries on next foreground if offline
    },
    [demo, refresh],
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

  const splitBill = useCallback<CompanionState["splitBill"]>(
    (input) =>
      enqueue({
        id: uuid4(),
        ts: Math.floor(Date.now() / 1000),
        kind: "splitBill",
        txnId: input.txnId,
        shares: input.shares,
        basisCents: input.basisCents ?? null,
        itemsJson: input.itemsJson ?? null,
        note: input.note ?? null,
      }),
    [enqueue],
  );

  const recordSettlement = useCallback<CompanionState["recordSettlement"]>(
    (input) =>
      enqueue({
        id: uuid4(),
        ts: Math.floor(Date.now() / 1000),
        kind: "recordSettlement",
        personId: input.personId,
        cents: input.cents,
        txnId: input.txnId ?? null,
      }),
    [enqueue],
  );

  // Also the way out of demo — the state it tears down is the state demo built,
  // so leaving sample data and unpairing a real device are the same operation.
  const unpair = useCallback(async () => {
    await clearMaterial();
    await clearCache();
    material.current = null;
    etag.current = null;
    setSummary(null);
    setPendingOps([]);
    setLastSyncAt(null);
    setSyncError(null);
    setDemo(false);
    setPhase("unpaired");
    latest.current = null;
  }, []);

  return (
    <Ctx.Provider
      value={{ phase, summary, pendingOps, lastSyncAt, syncError, refreshing, manualSyncAt, widget, demo, pair, enterDemo, refresh, recategorize, dismissAlert, splitBill, recordSettlement, unpair }}
    >
      {children}
    </Ctx.Provider>
  );
}

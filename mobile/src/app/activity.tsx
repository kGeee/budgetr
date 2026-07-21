// Activity — recent transactions; tap one to recategorize (optimistic, queued
// in the outbox until the Mac confirms via appliedOpIds). The category picker
// offers every key the phone has seen in this summary — the contract carries
// no separate category list.

import React, { useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TxnSummary } from "@budgetr/core";
import { categoryLabel, dayLabel, money } from "@/format";
import { T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Panel, SyncBanner } from "@/ui/bits";

export default function Activity() {
  const { summary, refresh, refreshing, recategorize, pendingOps } = useCompanion();
  const [picking, setPicking] = useState<TxnSummary | null>(null);

  const pendingTxnIds = useMemo(
    () => new Set(pendingOps.filter((o) => o.kind === "recategorize").map((o) => (o.kind === "recategorize" ? o.txnId : ""))),
    [pendingOps],
  );

  const categories = useMemo(() => {
    const keys = new Set<string>();
    for (const b of summary?.budgets ?? []) keys.add(b.category);
    for (const t of summary?.recent ?? []) keys.add(t.category);
    return [...keys].sort();
  }, [summary]);

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
      >
        <SyncBanner />
        <Panel>
          {(summary?.recent ?? []).map((t, i) => (
            <Pressable key={t.id} onPress={() => setPicking(t)} style={[s.row, i > 0 && s.rowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={s.merchant} numberOfLines={1}>
                  {t.merchant}
                  {t.pending ? <Text style={s.pendingTag}>  pending</Text> : null}
                </Text>
                <Text style={s.meta}>
                  {dayLabel(t.ts)} · {categoryLabel(t.category)}
                  {pendingTxnIds.has(t.id) ? <Text style={{ color: T.brass }}> · syncing…</Text> : null}
                </Text>
              </View>
              <Text style={[s.amount, t.cents > 0 && { color: T.jade }]}>{money(t.cents, { sign: true })}</Text>
            </Pressable>
          ))}
        </Panel>
      </ScrollView>

      <Modal visible={picking !== null} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicking(null)}>
          <View style={s.sheet} onStartShouldSetResponder={() => true}>
            <Text style={s.sheetTitle} numberOfLines={1}>
              {picking?.merchant}
            </Text>
            <Text style={s.sheetSub}>Move to category</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {categories.map((c) => (
                <Pressable
                  key={c}
                  style={s.catRow}
                  onPress={() => {
                    if (picking && c !== picking.category) recategorize(picking.id, c);
                    setPicking(null);
                  }}
                >
                  <Text style={[s.catText, picking?.category === c && { color: T.jade, fontWeight: "700" }]}>
                    {categoryLabel(c)}
                  </Text>
                  {picking?.category === c ? <Text style={{ color: T.jade }}>✓</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingTop: 62, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11, gap: 12 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  merchant: { color: T.paper, fontSize: 14.5 },
  pendingTag: { color: T.amber, fontSize: 11 },
  meta: { color: T.muted, fontSize: 12, marginTop: 2 },
  amount: { color: T.paper, fontSize: 14.5, fontVariant: ["tabular-nums"] },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: T.panel,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 36,
  },
  sheetTitle: { color: T.paper, fontSize: 16, fontWeight: "700" },
  sheetSub: { color: T.muted, fontSize: 12, marginTop: 2, marginBottom: 12 },
  catRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.line,
  },
  catText: { color: T.paper, fontSize: 15 },
});

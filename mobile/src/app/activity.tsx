// Activity — recent transactions; tap one to recategorize. Desktop amount
// convention: income renders jade, outflow renders paper (transactions-table).

import React, { useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TxnSummary } from "@budgetr/core";
import { categoryLabel, dayLabel, money } from "@/format";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Card, PageHead, SyncBanner } from "@/ui/bits";

export default function Activity() {
  const { summary, refresh, refreshing, recategorize, pendingOps } = useCompanion();
  const [picking, setPicking] = useState<TxnSummary | null>(null);

  const pendingTxnIds = useMemo(
    () => new Set(pendingOps.flatMap((o) => (o.kind === "recategorize" ? [o.txnId] : []))),
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
      <Aurora />
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
      >
        <PageHead title="Activity" />
        <SyncBanner />
        <Card>
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
        </Card>
      </ScrollView>

      <Modal visible={picking !== null} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <Pressable style={s.backdrop} onPress={() => setPicking(null)}>
          <View style={s.sheet} onStartShouldSetResponder={() => true}>
            <Text style={s.sheetTitle} numberOfLines={1}>
              {picking?.merchant}
            </Text>
            <Text style={s.sheetSub}>MOVE TO CATEGORY</Text>
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
                  <Text style={[s.catText, picking?.category === c && { color: T.jade, fontFamily: F.sansBold }]}>
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
  root: { flex: 1, backgroundColor: T.ink },
  content: { padding: 18, paddingTop: 74, paddingBottom: 44 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11, gap: 12 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  merchant: { color: T.paper, fontSize: 14.5, fontFamily: F.sansMedium },
  pendingTag: { color: T.brass, fontSize: 11, fontFamily: F.sans },
  meta: { color: T.faint, fontSize: 12, marginTop: 2, fontFamily: F.sans },
  amount: { color: T.paper, fontSize: 14, fontFamily: F.mono },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: T.panel,
    borderTopLeftRadius: T.radius,
    borderTopRightRadius: T.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    padding: 22,
    paddingBottom: 38,
  },
  sheetTitle: { color: T.paper, fontSize: 19, fontFamily: F.display },
  sheetSub: {
    color: T.brass,
    fontSize: 10.5,
    fontFamily: F.sansSemiBold,
    letterSpacing: 1.8,
    marginTop: 4,
    marginBottom: 12,
  },
  catRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.line,
  },
  catText: { color: T.paper, fontSize: 15, fontFamily: F.sans },
});

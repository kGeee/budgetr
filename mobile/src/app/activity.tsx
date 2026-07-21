// Activity — recent transactions; tap one to recategorize. Desktop amount
// convention: income renders jade, outflow renders paper (transactions-table).

import React, { useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TxnSummary } from "@budgetr/core";
import { categoryLabel, dayLabel, money } from "@/format";
import * as haptics from "@/haptics";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Bars, Card, Eyebrow, PageHead, SyncBanner } from "@/ui/bits";

const TIMEFRAMES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
] as const;

/** Daily spending over a selectable window — scrub the bars to read any day. */
function SpendChart({ points }: { points: import("@budgetr/core").SparkPoint[] }) {
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]>(TIMEFRAMES[1]);
  if (points.length === 0) return null;
  const cutoff = Math.floor(Date.now() / 1000) - tf.days * 86_400;
  const windowed = points.filter((p) => p.d >= cutoff);
  const total = windowed.reduce((a, p) => a + p.cents, 0);
  return (
    <Card>
      <View style={cs.head}>
        <View>
          <Eyebrow>{`Spending · ${tf.label.toLowerCase()}`}</Eyebrow>
          <Text style={cs.total}>{money(total)}</Text>
        </View>
        <View style={cs.chips}>
          {TIMEFRAMES.map((t) => (
            <Pressable
              key={t.label}
              onPress={() => {
                haptics.tick();
                setTf(t);
              }}
              style={[cs.chip, tf.label === t.label && cs.chipActive]}
            >
              <Text style={[cs.chipText, tf.label === t.label && cs.chipTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {windowed.length > 0 ? (
        <Bars points={windowed} height={64} />
      ) : (
        <Text style={cs.empty}>No spending in this window.</Text>
      )}
    </Card>
  );
}

const cs = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  total: { color: T.paper, fontSize: 24, fontFamily: F.display, marginTop: 6 },
  chips: { flexDirection: "row", gap: 6 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipActive: { backgroundColor: T.jade, borderColor: T.jade },
  chipText: { color: T.muted, fontSize: 11, fontFamily: F.sansSemiBold },
  chipTextActive: { color: T.onJade },
  empty: { color: T.faint, fontSize: 12, fontFamily: F.sans, marginTop: 12 },
});

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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              haptics.thud();
              void refresh();
            }}
            tintColor={T.muted}
          />
        }
      >
        <PageHead title="Activity" />
        <SyncBanner />
        <SpendChart points={summary?.spendByDay ?? []} />
        <Card>
          {(summary?.recent ?? []).map((t, i) => (
            <Pressable
              key={t.id}
              onPress={() => {
                haptics.thud();
                setPicking(t);
              }}
              style={[s.row, i > 0 && s.rowBorder]}
            >
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
                    if (picking && c !== picking.category) {
                      haptics.success();
                      recategorize(picking.id, c);
                    } else {
                      haptics.tick();
                    }
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

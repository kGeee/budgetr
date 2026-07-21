// Activity — daily-spend chart with timeframes, then recent transactions.
// Tapping a transaction opens a detail sheet (amount hero, meta, category);
// recategorizing happens inside it, optimistically, via the outbox.

import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated from "react-native-reanimated";
import type { SparkPoint, TxnSummary } from "@budgetr/core";
import { categoryLabel, dayLabel, money } from "@/format";
import * as haptics from "@/haptics";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Bars, Card, Eyebrow, PageHead, SyncBanner } from "@/ui/bits";
import { useEntering } from "@/ui/motion";
import { Sheet } from "@/ui/sheet";

const TIMEFRAMES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
] as const;

/** Daily spending over a selectable window — scrub the bars to read any day. */
function SpendChart({ points }: { points: SparkPoint[] }) {
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
              hitSlop={6}
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

/** Robinhood-style transaction detail: amount hero, meta rows, category. */
function TxnSheet({
  txn,
  categories,
  pending,
  onClose,
  onRecategorize,
}: {
  txn: TxnSummary | null;
  categories: string[];
  pending: boolean;
  onClose: () => void;
  onRecategorize: (txnId: string, toCategory: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const income = (txn?.cents ?? 0) > 0;

  return (
    <Sheet
      visible={txn !== null}
      onClose={() => {
        setPicking(false);
        onClose();
      }}
    >
      {txn && !picking && (
        <>
          <Text style={[tx.amount, income && { color: T.jade }]}>{money(txn.cents, { sign: true })}</Text>
          <Text style={tx.merchant} numberOfLines={2}>
            {txn.merchant}
          </Text>
          <View style={tx.rows}>
            <View style={tx.row}>
              <Text style={tx.rowLabel}>Date</Text>
              <Text style={tx.rowValue}>{dayLabel(txn.ts)}</Text>
            </View>
            <View style={tx.row}>
              <Text style={tx.rowLabel}>Status</Text>
              <Text style={[tx.rowValue, txn.pending && { color: T.brass }]}>
                {txn.pending ? "Pending" : "Posted"}
                {pending ? " · edit syncing…" : ""}
              </Text>
            </View>
            <Pressable
              style={tx.row}
              onPress={() => {
                haptics.tap();
                setPicking(true);
              }}
            >
              <Text style={tx.rowLabel}>Category</Text>
              <Text style={[tx.rowValue, { color: T.brass }]}>{categoryLabel(txn.category)} ›</Text>
            </Pressable>
          </View>
        </>
      )}
      {txn && picking && (
        <>
          <Text style={tx.pickTitle}>Move to category</Text>
          <ScrollView style={{ maxHeight: 380 }}>
            {categories.map((c) => (
              <Pressable
                key={c}
                style={tx.catRow}
                onPress={() => {
                  if (c !== txn.category) {
                    haptics.success();
                    onRecategorize(txn.id, c);
                  }
                  setPicking(false);
                  onClose();
                }}
              >
                <Text style={[tx.catText, txn.category === c && { color: T.jade, fontFamily: F.sansBold }]}>
                  {categoryLabel(c)}
                </Text>
                {txn.category === c ? <Text style={{ color: T.jade }}>✓</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </Sheet>
  );
}

export default function Activity() {
  const { summary, refresh, refreshing, recategorize, pendingOps } = useCompanion();
  const insets = useSafeAreaInsets();
  const entering = useEntering();
  const [selected, setSelected] = useState<TxnSummary | null>(null);

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
        contentContainerStyle={[s.content, { paddingTop: insets.top + 18 }]}
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
        <Animated.View entering={entering(0)}>
          <SpendChart points={summary?.spendByDay ?? []} />
        </Animated.View>
        <Animated.View entering={entering(1)}>
          <Card>
            {(summary?.recent ?? []).map((t, i) => (
              <Pressable
                key={t.id}
                onPress={() => {
                  haptics.thud();
                  setSelected(t);
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
        </Animated.View>
      </ScrollView>

      <TxnSheet
        txn={selected}
        categories={categories}
        pending={selected ? pendingTxnIds.has(selected.id) : false}
        onClose={() => setSelected(null)}
        onRecategorize={recategorize}
      />
    </View>
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

const tx = StyleSheet.create({
  amount: { color: T.paper, fontSize: 38, fontFamily: F.display, letterSpacing: -0.8, textAlign: "center", marginTop: 8 },
  merchant: { color: T.muted, fontSize: 15, fontFamily: F.sansMedium, textAlign: "center", marginTop: 4, marginBottom: 14 },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.line,
  },
  rowLabel: { color: T.muted, fontSize: 14, fontFamily: F.sans },
  rowValue: { color: T.paper, fontSize: 14, fontFamily: F.sansMedium },
  pickTitle: { color: T.brass, fontSize: 10.5, fontFamily: F.sansSemiBold, letterSpacing: 1.8, marginTop: 6, marginBottom: 10 },
  catRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.line,
  },
  catText: { color: T.paper, fontSize: 15, fontFamily: F.sans },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  content: { padding: 18, paddingBottom: 108 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11, gap: 12 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  merchant: { color: T.paper, fontSize: 14.5, fontFamily: F.sansMedium },
  pendingTag: { color: T.brass, fontSize: 11, fontFamily: F.sans },
  meta: { color: T.faint, fontSize: 12, marginTop: 2, fontFamily: F.sans },
  amount: { color: T.paper, fontSize: 14, fontFamily: F.mono },
});

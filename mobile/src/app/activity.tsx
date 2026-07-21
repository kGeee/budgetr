// Activity — daily-spend chart with timeframes, then recent transactions.
// Tapping a transaction opens a detail sheet (amount hero, meta, category);
// recategorizing happens inside it, optimistically, via the outbox.

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useReducedMotion, LinearTransition } from "react-native-reanimated";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { CategoryInfo, SparkPoint, TxnSummary } from "@budgetr/core";
import { dayLabel, money } from "@/format";
import { CategoryIcon, catName, categoryIndex, pickerCategories } from "@/categories";
import * as haptics from "@/haptics";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Bars, Card, Eyebrow, SyncBanner } from "@/ui/bits";
import { Screen } from "@/ui/screen";
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
  catIndex,
  pending,
  initialPicking,
  onClose,
  onRecategorize,
}: {
  txn: TxnSummary | null;
  categories: CategoryInfo[];
  catIndex: Map<string, CategoryInfo>;
  pending: boolean;
  initialPicking: boolean;
  onClose: () => void;
  onRecategorize: (txnId: string, toCategory: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const income = (txn?.cents ?? 0) > 0;
  useEffect(() => {
    setPicking(initialPicking);
  }, [txn?.id, initialPicking]);

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
              <Text style={[tx.rowValue, { color: T.brass }]}>{catName(catIndex, txn.category)} ›</Text>
            </Pressable>
          </View>
        </>
      )}
      {txn && picking && (
        <>
          <Text style={tx.pickTitle}>Move to category</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {(["spending", "income", "transfer"] as const).map((group) => {
              const inGroup = categories.filter((c) => c.group === group);
              if (inGroup.length === 0) return null;
              return (
                <View key={group}>
                  <Text style={tx.groupHead}>{group.toUpperCase()}</Text>
                  {inGroup.map((c) => (
                    <Pressable
                      key={c.id}
                      style={tx.catRow}
                      onPress={() => {
                        if (c.id !== txn.category) {
                          haptics.success();
                          onRecategorize(txn.id, c.id);
                        }
                        setPicking(false);
                        onClose();
                      }}
                    >
                      <View style={tx.catLeft}>
                        <CategoryIcon icon={c.icon} size={15} color={txn.category === c.id ? T.jade : T.muted} />
                        <Text style={[tx.catText, txn.category === c.id && { color: T.jade, fontFamily: F.sansBold }]}>
                          {c.name}
                        </Text>
                      </View>
                      {txn.category === c.id ? <Text style={{ color: T.jade }}>✓</Text> : null}
                    </Pressable>
                  ))}
                </View>
              );
            })}
          </ScrollView>
        </>
      )}
    </Sheet>
  );
}

export default function Activity() {
  const { summary, refresh, refreshing, recategorize, pendingOps } = useCompanion();
  const entering = useEntering();
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState<TxnSummary | null>(null);
  const [startPicking, setStartPicking] = useState(false);

  const pendingTxnIds = useMemo(
    () => new Set(pendingOps.flatMap((o) => (o.kind === "recategorize" ? [o.txnId] : []))),
    [pendingOps],
  );

  const categories = useMemo(() => pickerCategories(summary), [summary]);
  const catIndex = useMemo(() => categoryIndex(summary), [summary]);

  return (
    <>
      <Screen title="Activity" refreshing={refreshing} onRefresh={() => void refresh()}>
        <SyncBanner />
        <Animated.View entering={entering(0)}>
          <SpendChart points={summary?.spendByDay ?? []} />
        </Animated.View>
        <Animated.View entering={entering(1)}>
          <Card>
            {(summary?.recent ?? []).map((t, i) => (
              <Animated.View
                key={t.id}
                layout={reduced ? undefined : LinearTransition.springify().stiffness(320).damping(32)}
              >
                <ReanimatedSwipeable
                  friction={1.6}
                  rightThreshold={52}
                  overshootRight={false}
                  renderRightActions={() => (
                    <View style={s.swipeZone}>
                      <Text style={s.swipeZoneText}>Category</Text>
                    </View>
                  )}
                  onSwipeableWillOpen={() => {
                    haptics.tap();
                    setStartPicking(true);
                    setSelected(t);
                  }}
                >
                  <Pressable
                    onPress={() => {
                      haptics.thud();
                      setStartPicking(false);
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
                        {dayLabel(t.ts)} · {catName(catIndex, t.category)}
                        {pendingTxnIds.has(t.id) ? <Text style={{ color: T.brass }}> · syncing…</Text> : null}
                      </Text>
                    </View>
                    <Text style={[s.amount, t.cents > 0 && { color: T.jade }]}>{money(t.cents, { sign: true })}</Text>
                  </Pressable>
                </ReanimatedSwipeable>
              </Animated.View>
            ))}
          </Card>
        </Animated.View>
      </Screen>

      <TxnSheet
        txn={selected}
        categories={categories}
        catIndex={catIndex}
        pending={selected ? pendingTxnIds.has(selected.id) : false}
        initialPicking={startPicking}
        onClose={() => setSelected(null)}
        onRecategorize={recategorize}
      />
    </>
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
  catLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  groupHead: {
    color: T.brass,
    fontSize: 10,
    fontFamily: F.sansSemiBold,
    letterSpacing: 1.6,
    marginTop: 14,
    marginBottom: 2,
  },
});

const s = StyleSheet.create({
  swipeZone: {
    width: 92,
    marginLeft: 6,
    borderRadius: 12,
    backgroundColor: "rgba(111,227,166,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.jade,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeZoneText: { color: T.jade, fontFamily: F.sansSemiBold, fontSize: 12.5 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11, gap: 12 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  merchant: { color: T.paper, fontSize: 14.5, fontFamily: F.sansMedium },
  pendingTag: { color: T.brass, fontSize: 11, fontFamily: F.sans },
  meta: { color: T.faint, fontSize: 12, marginTop: 2, fontFamily: F.sans },
  amount: { color: T.paper, fontSize: 14, fontFamily: F.mono },
});

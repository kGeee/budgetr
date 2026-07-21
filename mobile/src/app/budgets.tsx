// Budgets — one bar per category colored by desktop-computed state (the phone
// never recomputes pace). Tap a budget to see its transactions from `recent`.

import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { categoryLabel, money } from "@/format";
import { stateColor, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Panel, SyncBanner } from "@/ui/bits";

export default function Budgets() {
  const { summary, refresh, refreshing } = useCompanion();
  const [openCat, setOpenCat] = useState<string | null>(null);

  const budgets = summary?.budgets ?? [];

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
    >
      <SyncBanner />
      {budgets.length === 0 && <Text style={s.emptyText}>No budgets set — add limits on your Mac.</Text>}

      {budgets.map((b) => {
        const pct = b.limitCents > 0 ? Math.min(1, b.spentCents / b.limitCents) : 1;
        const color = stateColor[b.state];
        const open = openCat === b.category;
        const txns = open ? (summary?.recent ?? []).filter((t) => t.category === b.category) : [];
        return (
          <Pressable key={b.category} onPress={() => setOpenCat(open ? null : b.category)}>
            <Panel>
              <View style={s.head}>
                <Text style={s.name}>{categoryLabel(b.category)}</Text>
                <Text style={s.amounts}>
                  <Text style={{ color }}>{money(b.spentCents)}</Text>
                  <Text style={s.limit}> / {money(b.limitCents)}</Text>
                </Text>
              </View>
              <View style={s.track}>
                <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
              </View>
              {b.state !== "ok" && (
                <Text style={[s.stateNote, { color }]}>
                  {b.state === "over" ? "over budget" : "approaching limit"}
                </Text>
              )}
              {open && (
                <View style={s.txns}>
                  {txns.length === 0 ? (
                    <Text style={s.txnEmpty}>No recent transactions in this category.</Text>
                  ) : (
                    txns.map((t) => (
                      <View key={t.id} style={s.txnRow}>
                        <Text style={s.txnName} numberOfLines={1}>
                          {t.merchant}
                        </Text>
                        <Text style={s.txnAmt}>{money(t.cents)}</Text>
                      </View>
                    ))
                  )}
                </View>
              )}
            </Panel>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingTop: 62, paddingBottom: 40 },
  emptyText: { color: T.muted, textAlign: "center", marginTop: 60, fontSize: 14 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  name: { color: T.paper, fontSize: 15, fontWeight: "600" },
  amounts: { fontSize: 13, fontVariant: ["tabular-nums"] },
  limit: { color: T.muted },
  track: { height: 7, borderRadius: 4, backgroundColor: T.panel2, marginTop: 10, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
  stateNote: { fontSize: 11, marginTop: 6, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.8 },
  txns: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line, paddingTop: 6 },
  txnEmpty: { color: T.muted, fontSize: 12, paddingVertical: 6 },
  txnRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 12 },
  txnName: { color: T.paper, fontSize: 13, flex: 1 },
  txnAmt: { color: T.muted, fontSize: 13, fontVariant: ["tabular-nums"] },
});

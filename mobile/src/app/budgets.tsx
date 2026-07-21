// Budgets — one bar per category, colored by the desktop-computed state
// (jade / brass / coral, matching the desktop's ok / warn / over semantics).
// Tap a budget to see its transactions from `recent`.

import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { categoryLabel, money } from "@/format";
import { F, stateColor, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Card, PageHead, SyncBanner } from "@/ui/bits";

export default function Budgets() {
  const { summary, refresh, refreshing } = useCompanion();
  const [openCat, setOpenCat] = useState<string | null>(null);

  const budgets = summary?.budgets ?? [];

  return (
    <View style={s.root}>
      <Aurora />
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
      >
        <PageHead title="Budgets" />
        <SyncBanner />
        {budgets.length === 0 && <Text style={s.emptyText}>No budgets set — add limits on your Mac.</Text>}

        {budgets.map((b) => {
          const pct = b.limitCents > 0 ? Math.min(1, b.spentCents / b.limitCents) : 1;
          const color = stateColor[b.state];
          const open = openCat === b.category;
          const txns = open ? (summary?.recent ?? []).filter((t) => t.category === b.category) : [];
          return (
            <Pressable key={b.category} onPress={() => setOpenCat(open ? null : b.category)}>
              <Card>
                <View style={s.head}>
                  <Text style={s.name}>{categoryLabel(b.category)}</Text>
                  <Text style={s.amounts}>
                    <Text style={[s.spent, { color }]}>{money(b.spentCents)}</Text>
                    <Text style={s.limit}> / {money(b.limitCents)}</Text>
                  </Text>
                </View>
                <View style={s.track}>
                  <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
                </View>
                {b.state !== "ok" && (
                  <Text style={[s.stateNote, { color }]}>
                    {b.state === "over" ? "Over budget" : "Approaching limit"}
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
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  content: { padding: 18, paddingTop: 74, paddingBottom: 44 },
  emptyText: { color: T.muted, textAlign: "center", marginTop: 60, fontSize: 14, fontFamily: F.sans },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  name: { color: T.paper, fontSize: 15.5, fontFamily: F.sansSemiBold, flexShrink: 1 },
  amounts: { fontSize: 13 },
  spent: { fontFamily: F.monoSemiBold },
  limit: { color: T.faint, fontFamily: F.mono },
  track: { height: 7, borderRadius: 4, backgroundColor: T.ink, marginTop: 12, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
  stateNote: {
    fontSize: 10.5,
    marginTop: 8,
    fontFamily: F.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  txns: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line, paddingTop: 6 },
  txnEmpty: { color: T.faint, fontSize: 12, paddingVertical: 6, fontFamily: F.sans },
  txnRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, gap: 12 },
  txnName: { color: T.muted, fontSize: 13, flex: 1, fontFamily: F.sans },
  txnAmt: { color: T.muted, fontSize: 13, fontFamily: F.mono },
});

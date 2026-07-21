// Holdings — read-only positions by value. No basis, no greeks, no lots:
// those never reach the phone by design; the Mac has the detail.

import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { moneyCompact } from "@/format";
import { T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Panel, SyncBanner } from "@/ui/bits";

export default function Holdings() {
  const { summary, refresh, refreshing } = useCompanion();
  const positions = summary?.positions ?? [];
  const total = positions.reduce((acc, p) => acc + p.cents, 0);

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
    >
      <SyncBanner />
      {positions.length === 0 ? (
        <Text style={s.emptyText}>No positions synced.</Text>
      ) : (
        <>
          <Panel style={s.hero}>
            <Text style={s.heroLabel}>PORTFOLIO VALUE</Text>
            <Text style={s.heroValue}>{moneyCompact(total)}</Text>
          </Panel>
          <Panel>
            {positions.map((p, i) => (
              <View key={p.symbol} style={[s.row, i > 0 && s.rowBorder]}>
                <Text style={s.symbol}>{p.symbol}</Text>
                <View style={s.barWrap}>
                  <View style={[s.bar, { width: `${total > 0 ? (p.cents / total) * 100 : 0}%` }]} />
                </View>
                <Text style={s.value}>{moneyCompact(p.cents)}</Text>
              </View>
            ))}
          </Panel>
          <Text style={s.footnote}>Cost basis, lots, and gains live on your Mac.</Text>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingTop: 62, paddingBottom: 40 },
  emptyText: { color: T.muted, textAlign: "center", marginTop: 60, fontSize: 14 },
  hero: { paddingVertical: 18 },
  heroLabel: { color: T.muted, fontSize: 11, letterSpacing: 1.6 },
  heroValue: { color: T.paper, fontSize: 32, fontWeight: "700", letterSpacing: -0.5, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  symbol: { color: T.paper, fontSize: 14, fontWeight: "600", width: 72 },
  barWrap: { flex: 1, height: 5, borderRadius: 3, backgroundColor: T.panel2, overflow: "hidden" },
  bar: { height: "100%", backgroundColor: T.brass, borderRadius: 3 },
  value: { color: T.paper, fontSize: 13, fontVariant: ["tabular-nums"], minWidth: 64, textAlign: "right" },
  footnote: { color: T.muted, fontSize: 12, textAlign: "center", marginTop: 14 },
});

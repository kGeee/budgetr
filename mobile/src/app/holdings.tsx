// Holdings — read-only positions by value with brass allocation bars.
// No basis, no greeks, no lots: the Mac has the detail, by design.

import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { moneyCompact } from "@/format";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Card, Eyebrow, PageHead, SyncBanner } from "@/ui/bits";

export default function Holdings() {
  const { summary, refresh, refreshing } = useCompanion();
  const positions = summary?.positions ?? [];
  const total = positions.reduce((acc, p) => acc + p.cents, 0);

  return (
    <View style={s.root}>
      <Aurora />
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
      >
        <PageHead title="Holdings" />
        <SyncBanner />
        {positions.length === 0 ? (
          <Text style={s.emptyText}>No positions synced.</Text>
        ) : (
          <>
            <Card style={s.hero}>
              <Eyebrow>Portfolio value</Eyebrow>
              <Text style={s.heroValue}>{moneyCompact(total)}</Text>
            </Card>
            <Card>
              {positions.map((p, i) => (
                <View key={p.symbol} style={[s.row, i > 0 && s.rowBorder]}>
                  <Text style={s.symbol}>{p.symbol}</Text>
                  <View style={s.barWrap}>
                    <View style={[s.bar, { width: `${total > 0 ? (p.cents / total) * 100 : 0}%` }]} />
                  </View>
                  <Text style={s.value}>{moneyCompact(p.cents)}</Text>
                </View>
              ))}
            </Card>
            <Text style={s.footnote}>Cost basis, lots, and gains live on your Mac.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  content: { padding: 18, paddingTop: 74, paddingBottom: 44 },
  emptyText: { color: T.muted, textAlign: "center", marginTop: 60, fontSize: 14, fontFamily: F.sans },
  hero: { paddingVertical: 22 },
  heroValue: { color: T.paper, fontSize: 34, fontFamily: F.display, letterSpacing: -0.5, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11, gap: 12 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  symbol: { color: T.paper, fontSize: 13.5, fontFamily: F.monoSemiBold, width: 76 },
  barWrap: { flex: 1, height: 5, borderRadius: 3, backgroundColor: T.ink, overflow: "hidden" },
  bar: { height: "100%", backgroundColor: T.brass, borderRadius: 3 },
  value: { color: T.paper, fontSize: 13, fontFamily: F.mono, minWidth: 68, textAlign: "right" },
  footnote: { color: T.faint, fontSize: 12, textAlign: "center", marginTop: 14, fontFamily: F.sans },
});

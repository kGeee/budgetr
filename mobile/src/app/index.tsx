// Home — net worth, 90-day spark, alerts (dismissable), accounts.

import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { money, moneyCompact } from "@/format";
import { T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Panel, SectionLabel, Spark, SyncBanner } from "@/ui/bits";

export default function Home() {
  const { summary, refresh, refreshing, dismissAlert, unpair } = useCompanion();
  if (!summary) {
    return (
      <ScrollView
        style={s.root}
        contentContainerStyle={s.empty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
      >
        <Text style={s.emptyText}>Waiting for your Mac&apos;s first sync…</Text>
        <Text style={s.emptySub}>Pull to retry. budgetr must be running on your Mac.</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
    >
      <SyncBanner />

      <Panel style={s.hero}>
        <Text style={s.heroLabel}>NET WORTH</Text>
        <Text style={s.heroValue}>{money(summary.netWorth.cents)}</Text>
        <Spark points={summary.netWorth.spark} />
      </Panel>

      {summary.alerts.length > 0 && (
        <>
          <SectionLabel>Alerts</SectionLabel>
          {summary.alerts.map((a) => (
            <Panel key={a.id} style={s.alert}>
              <Text style={s.alertText}>{a.text}</Text>
              <Pressable onPress={() => dismissAlert(a.id)} hitSlop={10}>
                <Text style={s.alertDismiss}>Dismiss</Text>
              </Pressable>
            </Panel>
          ))}
        </>
      )}

      <SectionLabel>Accounts</SectionLabel>
      <Panel>
        {summary.accounts.map((a, i) => (
          <View key={a.id} style={[s.row, i > 0 && s.rowBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>{a.name}</Text>
              <Text style={s.rowKind}>{a.kind}</Text>
            </View>
            <Text style={[s.rowValue, a.cents < 0 && { color: T.coral }]}>{moneyCompact(a.cents)}</Text>
          </View>
        ))}
      </Panel>

      <Pressable onPress={() => void unpair()} style={s.unpair}>
        <Text style={s.unpairText}>Unpair this phone</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingTop: 62, paddingBottom: 40 },
  empty: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyText: { color: T.paper, fontSize: 16, fontWeight: "600" },
  emptySub: { color: T.muted, fontSize: 13, marginTop: 6, textAlign: "center" },
  hero: { paddingVertical: 20 },
  heroLabel: { color: T.muted, fontSize: 11, letterSpacing: 1.6 },
  heroValue: { color: T.paper, fontSize: 40, fontWeight: "700", letterSpacing: -1, marginTop: 4 },
  alert: { flexDirection: "row", alignItems: "center", gap: 12, borderColor: T.amber },
  alertText: { color: T.paper, fontSize: 13, flex: 1, lineHeight: 18 },
  alertDismiss: { color: T.brass, fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  rowName: { color: T.paper, fontSize: 15 },
  rowKind: { color: T.muted, fontSize: 11, marginTop: 1, textTransform: "capitalize" },
  rowValue: { color: T.paper, fontSize: 15, fontVariant: ["tabular-nums"] },
  unpair: { alignItems: "center", marginTop: 18 },
  unpairText: { color: T.muted, fontSize: 12, textDecorationLine: "underline" },
});

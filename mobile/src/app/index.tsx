// Overview — net worth in Fraunces over the sparkline, alerts, accounts.
// Amount color convention matches the desktop: income jade, outflow paper.

import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { money, moneyCompact } from "@/format";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Card, Eyebrow, PageHead, Spark, SyncBanner } from "@/ui/bits";

export default function Overview() {
  const { summary, refresh, refreshing, dismissAlert, unpair } = useCompanion();

  if (!summary) {
    return (
      <View style={s.root}>
        <Aurora />
        <ScrollView
          contentContainerStyle={s.empty}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
        >
          <Text style={s.emptyText}>Waiting for your Mac&apos;s first sync…</Text>
          <Text style={s.emptySub}>Pull to retry. budgetr must be running on your Mac.</Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Aurora />
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={T.muted} />}
      >
        <PageHead title="Overview" />
        <SyncBanner />

        <Card style={s.hero}>
          <Eyebrow>Net worth</Eyebrow>
          <Text style={s.heroValue}>{money(summary.netWorth.cents)}</Text>
          <Spark points={summary.netWorth.spark} />
        </Card>

        {summary.alerts.length > 0 && (
          <>
            {summary.alerts.map((a) => (
              <Card key={a.id} style={s.alert}>
                <View style={{ flex: 1 }}>
                  <Eyebrow color={T.coral}>{a.kind === "large_move" ? "Spending spike" : "Alert"}</Eyebrow>
                  <Text style={s.alertText}>{a.text}</Text>
                </View>
                <Pressable onPress={() => dismissAlert(a.id)} hitSlop={10}>
                  <Text style={s.alertDismiss}>Dismiss</Text>
                </Pressable>
              </Card>
            ))}
          </>
        )}

        <Card>
          <Eyebrow>Accounts</Eyebrow>
          <View style={{ marginTop: 8 }}>
            {summary.accounts.map((a, i) => (
              <View key={a.id} style={[s.row, i > 0 && s.rowBorder]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>{a.name}</Text>
                  <Text style={s.rowKind}>{a.kind}</Text>
                </View>
                <Text style={[s.rowValue, a.cents < 0 && { color: T.coral }]}>{moneyCompact(a.cents)}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Pressable onPress={() => void unpair()} style={s.unpair}>
          <Text style={s.unpairText}>Unpair this phone</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  content: { padding: 18, paddingTop: 74, paddingBottom: 44 },
  empty: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyText: { color: T.paper, fontSize: 16, fontFamily: F.sansSemiBold },
  emptySub: { color: T.muted, fontSize: 13, marginTop: 6, textAlign: "center", fontFamily: F.sans },
  hero: { paddingVertical: 22 },
  heroValue: { color: T.paper, fontSize: 42, fontFamily: F.display, letterSpacing: -0.8, marginTop: 8 },
  alert: { flexDirection: "row", alignItems: "center", gap: 12, borderColor: T.lineStrong },
  alertText: { color: T.paper, fontSize: 13.5, lineHeight: 19, fontFamily: F.sans, marginTop: 6 },
  alertDismiss: { color: T.brass, fontSize: 13, fontFamily: F.sansSemiBold },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  rowName: { color: T.paper, fontSize: 15, fontFamily: F.sansMedium },
  rowKind: { color: T.faint, fontSize: 11, marginTop: 2, textTransform: "capitalize", fontFamily: F.sans },
  rowValue: { color: T.paper, fontSize: 14.5, fontFamily: F.mono },
  unpair: { alignItems: "center", marginTop: 16 },
  unpairText: { color: T.faint, fontSize: 12, textDecorationLine: "underline", fontFamily: F.sans },
});

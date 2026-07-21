// Overview — large-title screen: net worth hero (counts to new values over
// the scrubbable spark), swipe-to-dismiss alerts, accounts. Settings live
// behind the gear in an interruptible sheet.

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Constants from "expo-constants";
import { Settings2 } from "lucide-react-native";
import { agoLabel, moneyCompact } from "@/format";
import * as haptics from "@/haptics";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Card, Eyebrow, Spark, SyncBanner } from "@/ui/bits";
import { AnimatedMoney, PressableScale, useEntering } from "@/ui/motion";
import { Screen } from "@/ui/screen";
import { Sheet } from "@/ui/sheet";

function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { lastSyncAt, refresh, unpair, syncError } = useCompanion();
  const [confirming, setConfirming] = useState(false);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={st.title}>Settings</Text>
      <Text style={st.sub}>COMPANION</Text>

      <View style={st.row}>
        <Text style={st.rowLabel}>Last sync</Text>
        <Text style={st.rowValue}>{agoLabel(lastSyncAt)}</Text>
      </View>
      <View style={st.row}>
        <Text style={st.rowLabel}>Status</Text>
        <Text style={[st.rowValue, { color: syncError ? T.brass : T.jade }]}>{syncError ?? "healthy"}</Text>
      </View>
      <View style={st.row}>
        <Text style={st.rowLabel}>Version</Text>
        <Text style={st.rowValue}>{Constants.expoConfig?.version ?? "dev"}</Text>
      </View>

      <Text style={st.privacy}>
        Your Mac is the source of truth. This phone holds an end-to-end encrypted snapshot — the
        relay in between can never read it, and nothing here can be recovered without your devices.
      </Text>

      <Pressable
        style={st.action}
        onPress={() => {
          haptics.thud();
          void refresh();
        }}
      >
        <Text style={st.actionText}>Sync now</Text>
      </Pressable>

      <Pressable
        style={[st.action, st.danger]}
        onPress={() => {
          if (!confirming) {
            haptics.warning();
            setConfirming(true);
            setTimeout(() => setConfirming(false), 3000); // easy escape — it just reverts
          } else {
            haptics.error();
            onClose();
            void unpair();
          }
        }}
      >
        <Text style={[st.actionText, { color: T.coral }]}>
          {confirming ? "Tap again to unpair — this phone forgets everything" : "Unpair this phone"}
        </Text>
      </Pressable>
    </Sheet>
  );
}

/** Alert card you can swipe away — the swipe IS the dismissal (with an op). */
function AlertRow({ id, kind, text, index }: { id: string; kind: string; text: string; index: number }) {
  const { dismissAlert } = useCompanion();
  const reduced = useReducedMotion();
  const entering = useEntering();

  return (
    <Animated.View
      entering={entering(index + 1)}
      exiting={FadeOut.duration(180)}
      layout={reduced ? undefined : LinearTransition.springify().stiffness(320).damping(32)}
    >
      <ReanimatedSwipeable
        friction={1.6}
        rightThreshold={56}
        overshootRight={false}
        renderRightActions={() => (
          <View style={s.swipeZone}>
            <Text style={s.swipeZoneText}>Dismiss</Text>
          </View>
        )}
        onSwipeableWillOpen={() => {
          haptics.success();
          dismissAlert(id);
        }}
      >
        <Card style={s.alert}>
          <View style={{ flex: 1 }}>
            <Eyebrow color={T.coral}>{kind === "large_move" ? "Spending spike" : "Alert"}</Eyebrow>
            <Text style={s.alertText}>{text}</Text>
          </View>
          <Text style={s.alertHint}>‹ swipe</Text>
        </Card>
      </ReanimatedSwipeable>
    </Animated.View>
  );
}

export default function Overview() {
  const { summary, refresh, refreshing } = useCompanion();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const entering = useEntering();

  const gear = (
    <PressableScale
      hitSlop={12}
      onPress={() => {
        haptics.tap();
        setSettingsOpen(true);
      }}
      style={s.gear}
    >
      <Settings2 size={17} color={T.muted} />
    </PressableScale>
  );

  return (
    <>
      <Screen title="Overview" action={gear} refreshing={refreshing} onRefresh={() => void refresh()}>
        <SyncBanner />
        {!summary ? (
          <View style={s.empty}>
            <Text style={s.emptyText}>Waiting for your Mac&apos;s first sync…</Text>
            <Text style={s.emptySub}>Pull to retry. budgetr must be running on your Mac.</Text>
          </View>
        ) : (
          <>
            <Animated.View entering={entering(0)}>
              <Card style={s.hero}>
                <Eyebrow>Net worth</Eyebrow>
                <AnimatedMoney cents={summary.netWorth.cents} style={s.heroValue} />
                <Spark points={summary.netWorth.spark} height={116} />
              </Card>
            </Animated.View>

            {summary.alerts.map((a, i) => (
              <AlertRow key={a.id} id={a.id} kind={a.kind} text={a.text} index={i} />
            ))}

            <Animated.View
              entering={entering(summary.alerts.length + 1)}
              layout={LinearTransition.springify().stiffness(320).damping(32)}
            >
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
            </Animated.View>
          </>
        )}
      </Screen>
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

const s = StyleSheet.create({
  empty: { alignItems: "center", paddingVertical: 120 },
  emptyText: { color: T.paper, fontSize: 16, fontFamily: F.sansSemiBold },
  emptySub: { color: T.muted, fontSize: 13, marginTop: 6, textAlign: "center", fontFamily: F.sans },
  gear: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    backgroundColor: T.panel,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  hero: { paddingVertical: 22 },
  heroValue: { color: T.paper, fontSize: 42, fontFamily: F.display, letterSpacing: -0.8, marginTop: 8 },
  alert: { flexDirection: "row", alignItems: "center", gap: 12, borderColor: T.lineStrong },
  alertText: { color: T.paper, fontSize: 13.5, lineHeight: 19, fontFamily: F.sans, marginTop: 6 },
  alertHint: { color: T.faint, fontSize: 11, fontFamily: F.sans },
  swipeZone: {
    width: 96,
    borderRadius: T.radius,
    marginBottom: 14,
    marginLeft: 8,
    backgroundColor: "rgba(240,137,123,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.coral,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeZoneText: { color: T.coral, fontFamily: F.sansSemiBold, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  rowName: { color: T.paper, fontSize: 15, fontFamily: F.sansMedium },
  rowKind: { color: T.faint, fontSize: 11, marginTop: 2, textTransform: "capitalize", fontFamily: F.sans },
  rowValue: { color: T.paper, fontSize: 14.5, fontFamily: F.mono },
});

const st = StyleSheet.create({
  title: { color: T.paper, fontSize: 21, fontFamily: F.display },
  sub: { color: T.brass, fontSize: 10.5, fontFamily: F.sansSemiBold, letterSpacing: 1.8, marginTop: 4, marginBottom: 10 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.line,
  },
  rowLabel: { color: T.muted, fontSize: 14, fontFamily: F.sans },
  rowValue: { color: T.paper, fontSize: 14, fontFamily: F.mono },
  privacy: { color: T.faint, fontSize: 12.5, lineHeight: 18, fontFamily: F.sans, marginTop: 14, marginBottom: 6 },
  action: {
    marginTop: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    backgroundColor: T.panel2,
    paddingVertical: 12,
    alignItems: "center",
  },
  danger: { backgroundColor: "transparent", borderColor: T.coral + "55" },
  actionText: { color: T.paper, fontSize: 14.5, fontFamily: F.sansSemiBold },
});

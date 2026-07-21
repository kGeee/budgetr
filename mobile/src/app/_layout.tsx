// Root layout: polyfill first (tweetnacl needs getRandomValues), then the
// companion provider gates everything — unpaired shows the pairing screen,
// a newer summary version shows "update required", otherwise the four tabs.

import "react-native-get-random-values";

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { CompanionProvider, useCompanion } from "@/state/companion";
import { PairingScreen } from "@/ui/pairing";
import { T } from "@/theme";

function Gate({ children }: { children: React.ReactNode }) {
  const { phase } = useCompanion();
  if (phase === "loading") return <View style={s.blank} />;
  if (phase === "unpaired") return <PairingScreen />;
  if (phase === "update-required") {
    return (
      <View style={s.center}>
        <Text style={s.updateTitle}>Update required</Text>
        <Text style={s.updateBody}>
          Your Mac is running a newer version of budgetr than this app understands. Update the
          companion app to keep syncing — your data is safe on your Mac.
        </Text>
      </View>
    );
  }
  return <>{children}</>;
}

function TabIcon({ glyph, color }: { glyph: string; color: import("react-native").ColorValue }) {
  return <Text style={{ fontSize: 17, color }}>{glyph}</Text>;
}

export default function RootLayout() {
  return (
    <CompanionProvider>
      <StatusBar style="light" />
      <Gate>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarStyle: { backgroundColor: T.panel, borderTopColor: T.line },
            tabBarActiveTintColor: T.jade,
            tabBarInactiveTintColor: T.muted,
          }}
        >
          <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: (p) => <TabIcon glyph="◉" color={p.color} /> }} />
          <Tabs.Screen name="budgets" options={{ title: "Budgets", tabBarIcon: (p) => <TabIcon glyph="▤" color={p.color} /> }} />
          <Tabs.Screen name="activity" options={{ title: "Activity", tabBarIcon: (p) => <TabIcon glyph="⇅" color={p.color} /> }} />
          <Tabs.Screen name="holdings" options={{ title: "Holdings", tabBarIcon: (p) => <TabIcon glyph="◆" color={p.color} /> }} />
        </Tabs>
      </Gate>
    </CompanionProvider>
  );
}

const s = StyleSheet.create({
  blank: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, backgroundColor: T.bg, alignItems: "center", justifyContent: "center", padding: 32 },
  updateTitle: { color: T.paper, fontSize: 22, fontWeight: "700", marginBottom: 10 },
  updateBody: { color: T.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
});

// Root layout: polyfill first (tweetnacl needs getRandomValues), desktop fonts
// (Fraunces / Hanken Grotesk / Spline Sans Mono), then the companion provider
// gates everything — unpaired shows pairing, a newer summary version shows
// "update required", otherwise the four tabs with the desktop's sidebar icons.

import "react-native-get-random-values";

import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Fraunces_600SemiBold, Fraunces_700Bold } from "@expo-google-fonts/fraunces";
import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";
import { SplineSansMono_500Medium, SplineSansMono_600SemiBold } from "@expo-google-fonts/spline-sans-mono";
import { ArrowLeftRight, LineChart, PieChart, Wallet } from "lucide-react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { CompanionProvider, useCompanion } from "@/state/companion";
import { PairingScreen } from "@/ui/pairing";
import { DemoRibbon, Skeleton } from "@/ui/bits";
import { FloatingTabBar } from "@/ui/tabbar";
import { F, T } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

function Gate({ children }: { children: React.ReactNode }) {
  const { phase } = useCompanion();
  if (phase === "loading") return <Skeleton />;
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
  // The ribbon renders after the tabs so it overlays them, and inside the gate
  // so it can't outlive the state that put it there.
  return (
    <View style={{ flex: 1 }}>
      {children}
      <DemoRibbon />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    SplineSansMono_500Medium,
    SplineSansMono_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return <View style={s.blank} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <CompanionProvider>
      <StatusBar style="light" />
      <Gate>
        <Tabs
          // A custom floating pill bar (content scrolls under it) replaces the
          // default strip — it owns its own press haptics and active state.
          tabBar={(props) => <FloatingTabBar {...props} />}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: T.ink },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{ title: "Spending", tabBarIcon: ({ color }) => <PieChart size={20} color={color} /> }}
          />
          <Tabs.Screen
            name="budgets"
            options={{ title: "Budgets", tabBarIcon: ({ color }) => <Wallet size={20} color={color} /> }}
          />
          <Tabs.Screen
            name="activity"
            options={{ title: "Activity", tabBarIcon: ({ color }) => <ArrowLeftRight size={20} color={color} /> }}
          />
          <Tabs.Screen
            name="holdings"
            options={{ title: "Holdings", tabBarIcon: ({ color }) => <LineChart size={20} color={color} /> }}
          />
        </Tabs>
      </Gate>
    </CompanionProvider>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  blank: { flex: 1, backgroundColor: T.ink },
  center: { flex: 1, backgroundColor: T.ink, alignItems: "center", justifyContent: "center", padding: 32 },
  updateTitle: { color: T.paper, fontSize: 24, fontFamily: F.display, marginBottom: 10 },
  updateBody: { color: T.muted, fontSize: 14, lineHeight: 20, textAlign: "center", fontFamily: F.sans },
});

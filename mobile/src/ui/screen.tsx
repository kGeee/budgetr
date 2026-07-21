// Screen scaffold with the iOS large-title grammar:
//  - the Fraunces page title lives in content and stretches slightly on
//    overscroll (rubbery, like Apple's large titles)
//  - a compact blurred header MATERIALIZES only when content actually scrolls
//    under it (scroll-edge effect — no permanent hard divider)
//  - the aurora drifts at 0.15x scroll for depth
//  - reduced motion keeps everything, minus the stretch and drift.

import React from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import * as haptics from "@/haptics";
import { F, T } from "@/theme";
import { Aurora, PageHead } from "@/ui/bits";

export function Screen({
  title,
  action,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const scrollY = useSharedValue(0);
  const headerH = insets.top + 40;

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // Compact header: invisible until the large title has scrolled under it.
  const compactStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [36, 72], [0, 1], Extrapolation.CLAMP),
  }));

  // Large title stretches on pull — anchored to its leading edge.
  const titleStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    const scale = interpolate(scrollY.value, [-100, 0], [1.06, 1], Extrapolation.CLAMP);
    return { transform: [{ scale }], transformOrigin: "left bottom" };
  });

  // Depth: the atmosphere moves slower than the content.
  const auroraStyle = useAnimatedStyle(() =>
    reduced ? {} : { transform: [{ translateY: -scrollY.value * 0.15 }] },
  );

  return (
    <View style={s.root}>
      <Animated.View style={[StyleSheet.absoluteFill, auroraStyle]} pointerEvents="none">
        <Aurora />
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[s.content, { paddingTop: insets.top + 18 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              haptics.thud();
              onRefresh();
            }}
            tintColor={T.muted}
          />
        }
      >
        <Animated.View style={titleStyle}>
          <PageHead title={title} action={action} />
        </Animated.View>
        {children}
      </Animated.ScrollView>

      <Animated.View style={[s.header, { height: headerH }, compactStyle]} pointerEvents="none">
        <BlurView tint="dark" intensity={40} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(8,11,10,0.55)" }]} />
        <Text style={[s.compactTitle, { marginTop: insets.top }]}>{title}</Text>
        <View style={s.hairline} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  content: { padding: 18, paddingBottom: 108 },
  header: { position: "absolute", top: 0, left: 0, right: 0, justifyContent: "center" },
  compactTitle: {
    fontFamily: F.sansSemiBold,
    color: T.paper,
    fontSize: 15,
    textAlign: "center",
  },
  hairline: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: T.line,
  },
});

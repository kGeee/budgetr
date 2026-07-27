// Floating pill tab bar — the reference's signature nav, in budgetr's dark
// grammar. The bar is a single blurred material pill hovering above the safe
// area; the active tab alone expands into a raised jade-labeled pill while the
// others stay icon-only. The width change springs (Reanimated layout), so the
// selection slides between tabs like a physical detent rather than snapping.
// Reduced motion keeps the label but drops the spring.

import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import Animated, { FadeIn, LinearTransition, useReducedMotion } from "react-native-reanimated";
import { ArrowLeftRight, LayoutDashboard, LineChart, Wallet, type LucideIcon } from "lucide-react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import * as haptics from "@/haptics";
import { F, T } from "@/theme";

const ICONS: Record<string, LucideIcon> = {
  index: LayoutDashboard,
  budgets: Wallet,
  activity: ArrowLeftRight,
  holdings: LineChart,
};

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  return (
    <View style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <View style={s.pill}>
        <BlurView tint="dark" intensity={30} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, s.tint]} />
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key]!;
          const label = (options.title ?? route.name) as string;
          const Icon = ICONS[route.name] ?? LayoutDashboard;
          const focused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (focused || event.defaultPrevented) return;
            haptics.tick();
            navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              hitSlop={8}
              onPress={onPress}
              style={s.slot}
            >
              <Animated.View
                layout={reduced ? undefined : LinearTransition.springify().stiffness(360).damping(30)}
                style={[s.item, focused && s.itemActive]}
              >
                <Icon size={20} color={focused ? T.jade : T.faint} strokeWidth={focused ? 2.4 : 2} />
                {focused && (
                  <Animated.Text
                    entering={reduced ? undefined : FadeIn.duration(160)}
                    numberOfLines={1}
                    style={s.label}
                  >
                    {label}
                  </Animated.Text>
                )}
              </Animated.View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    height: 60,
    borderRadius: 30,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.lineStrong,
    // Same floating-material drop the cards use, a touch deeper for lift.
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  tint: { backgroundColor: "rgba(19,26,24,0.82)" },
  slot: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
  },
  itemActive: {
    backgroundColor: T.panel2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(111,227,166,0.30)",
  },
  label: {
    color: T.jade,
    fontFamily: F.sansSemiBold,
    fontSize: 13.5,
    letterSpacing: 0.1,
  },
});

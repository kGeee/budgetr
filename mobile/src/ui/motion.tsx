// Motion primitives following Apple's fluid-interface grammar:
//  - respond on press-DOWN, never on release (PressableScale)
//  - springs, critically damped by default; bounce only after momentum
//  - animate from the current on-screen value (AnimatedMoney restarts count
//    from whatever is displayed, never from the logical start)
//  - reduced-motion means gentler, not dead: cross-fades replace movement.

import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, type PressableProps, type TextStyle } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { money } from "@/format";

// Apple's "response 0.3–0.4, damping 1.0" translated to Reanimated's params.
export const SPRING_SNAPPY = { stiffness: 420, damping: 41, mass: 1 } as const; // critically damped, ~0.3s
export const SPRING_SHEET = { stiffness: 440, damping: 42, mass: 1 } as const; // ratio ~1.0 — settles without bouncing

/** Staggered entrance for cards: gentle rise + fade, or pure fade under reduced motion. */
export function useEntering() {
  const reduced = useReducedMotion();
  return (index = 0) =>
    reduced
      ? FadeIn.duration(180).delay(index * 30)
      : FadeInDown.springify().stiffness(320).damping(42).delay(index * 55);
}

/**
 * Pressable that scales down the instant the finger lands (0.97, like the
 * desktop's .lift inverted) and springs back on release/cancel. Feedback on
 * pointer-down is the whole point — never wait for the tap to commit.
 */
export function PressableScale({ children, style, disabled, ...rest }: PressableProps & { children: React.ReactNode }) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        if (!reduced && !disabled) scale.value = withSpring(0.97, SPRING_SNAPPY);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, SPRING_SNAPPY);
        rest.onPressOut?.(e);
      }}
    >
      <Animated.View style={[style as object, animStyle]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * Money that counts to its new value — restarting from whatever is currently
 * DISPLAYED when the target changes mid-flight (presentation value, §3 of the
 * fluid-interface rules). Reduced motion snaps directly.
 */
export function AnimatedMoney({ cents, style }: { cents: number; style?: TextStyle | TextStyle[] }) {
  const [shown, setShown] = useState(cents);
  const shownRef = useRef(cents);
  const raf = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || Math.abs(cents - shownRef.current) < 100) {
      shownRef.current = cents;
      setShown(cents);
      return;
    }
    const from = shownRef.current; // current on-screen value, not the old target
    const delta = cents - from;
    const start = Date.now();
    const DUR = 550;
    if (raf.current) cancelAnimationFrame(raf.current);
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / DUR);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic — settles, never overshoots
      const value = Math.round(from + delta * eased);
      shownRef.current = value;
      setShown(value);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [cents, reduced]);

  return <Text style={style}>{money(shown)}</Text>;
}

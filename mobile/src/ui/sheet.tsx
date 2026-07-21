// Bottom sheet with the full fluid-interface treatment:
//  - slides up on a slightly under-damped spring (it arrives with momentum)
//  - 1:1 finger tracking on drag, rubber-banding when pushed above rest
//  - release uses momentum PROJECTION (Apple's exponential-decay form) to
//    decide dismiss vs return, and hands the finger's velocity to the spring
//    so there is no seam between dragging and animating
//  - backdrop dims in proportion to sheet position (same frame, same value)
//  - reduced motion: cross-fade instead of travel.

import React, { useCallback, useEffect, useMemo } from "react";
import { Modal, PanResponder, StyleSheet, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as haptics from "@/haptics";
import { T } from "@/theme";
import { SPRING_SHEET } from "./motion";

/** Apple's momentum projection: where would this flick coast to? */
function project(velocityPxS: number, decelerationRate = 0.998): number {
  return ((velocityPxS / 1000) * decelerationRate) / (1 - decelerationRate);
}

function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function Sheet({
  visible,
  onClose,
  children,
  contentStyle,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
}) {
  const { height: screenH } = useWindowDimensions();
  const ty = useSharedValue(screenH);
  const dragStart = useSharedValue(0);
  const reduced = useReducedMotion();

  const close = useCallback(() => {
    haptics.tick();
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      haptics.thud();
      ty.value = reduced ? withTiming(0, { duration: 180 }) : withSpring(0, SPRING_SHEET);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduced]);

  const dismiss = useCallback(
    (velocity = 0) => {
      ty.value = reduced
        ? withTiming(screenH, { duration: 160 }, () => runOnJS(close)())
        : withSpring(screenH, { ...SPRING_SHEET, velocity }, () => runOnJS(close)());
    },
    [ty, screenH, reduced, close],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        // A vertical intent threshold (~10px hysteresis) before the sheet
        // claims the gesture — taps and horizontal scrolls pass through.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          dragStart.value = ty.value; // grab wherever it currently is — mid-flight included
        },
        onPanResponderMove: (_e, g) => {
          const raw = dragStart.value + g.dy;
          // 1:1 downward; progressive resistance above the rest position
          ty.value = raw >= 0 ? raw : rubberband(raw, screenH);
        },
        onPanResponderRelease: (_e, g) => {
          const projected = ty.value + project(g.vy * 1000);
          if (projected > screenH * 0.3) {
            runOnJS(dismiss)(g.vy * 1000);
          } else {
            ty.value = withSpring(0, { ...SPRING_SHEET, velocity: g.vy * 1000 });
          }
        },
        onPanResponderTerminate: () => {
          ty.value = withSpring(0, SPRING_SHEET);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screenH, dismiss],
  );

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  // The scrim dims in lockstep with sheet position — same value, same frame.
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [0, screenH], [1, 0]),
  }));

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={() => dismiss()}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[s.scrim, scrimStyle]}>
          <View style={StyleSheet.absoluteFill} onTouchEnd={() => dismiss()} />
        </Animated.View>
        <Animated.View style={[s.sheet, contentStyle, sheetStyle]} {...pan.panHandlers}>
          <View style={s.grabber} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: T.panel,
    borderTopLeftRadius: T.radius,
    borderTopRightRadius: T.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    paddingHorizontal: 22,
    paddingBottom: 40,
    paddingTop: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: T.line,
    marginBottom: 12,
  },
});

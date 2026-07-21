// Semantic haptics — a thin, intention-named wrapper over expo-haptics so the
// app reads as physical: a tick when you scrub a chart, a soft thud when a
// sheet or refresh commits, a success/error pulse on pairing. Every call is
// fire-and-forget and no-ops on web (and if the Taptic Engine is unavailable),
// so callers never need to await or guard.

import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

const enabled = Platform.OS === "ios" || Platform.OS === "android";

/** Light selection tick — scrubbing a chart, crossing a value, toggling a row. */
export function tick() {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
}

/** A press landed — light impact for taps that open or commit something small. */
export function tap() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A heavier commit — a sheet opening, a pull-to-refresh firing. */
export function thud() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** It worked — pairing succeeded, an edit was accepted. */
export function success() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** A destructive or cautionary action — unpairing, dismissing. */
export function warning() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Something failed — a bad pairing code, a rejected sync. */
export function error() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

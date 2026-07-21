// Shared UI ported from the desktop's design system:
// Card (panel-2 → panel gradient, 18px radius, hairline border, soft drop),
// Eyebrow (brass editorial micro-label), PageHead (eyebrow date + Fraunces
// display title over a hairline), Aurora (the jade/brass atmospheric wash),
// SyncBanner, and an SVG sparkline.

import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import type { SparkPoint } from "@budgetr/core";
import { agoLabel } from "@/format";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <LinearGradient colors={[T.panel2, T.panel]} style={[s.card, style]}>
      {children}
    </LinearGradient>
  );
}

/** Editorial uppercase micro-label — the desktop's .eyebrow. */
export function Eyebrow({ children, color = T.brass }: { children: string; color?: string }) {
  return <Text style={[s.eyebrow, { color }]}>{children}</Text>;
}

/** Desktop PageHead: eyebrow date, Fraunces display title, hairline below. */
export function PageHead({ title }: { title: string }) {
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return (
    <View style={s.pageHead}>
      <Eyebrow>{date}</Eyebrow>
      <Text style={s.pageTitle}>{title}</Text>
    </View>
  );
}

/** The desktop's atmospheric base: jade aurora top-left, brass wash top-right. */
export function Aurora() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <RadialGradient id="jade" cx="12%" cy="-8%" rx="90%" ry="45%">
          <Stop offset="0" stopColor={T.jade} stopOpacity="0.07" />
          <Stop offset="1" stopColor={T.jade} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="brass" cx="100%" cy="0%" rx="70%" ry="38%">
          <Stop offset="0" stopColor={T.brass} stopOpacity="0.05" />
          <Stop offset="1" stopColor={T.brass} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#jade)" />
      <Rect width="100%" height="100%" fill="url(#brass)" />
    </Svg>
  );
}

/** "Synced Xm ago" + error/pending state — errors are states, not crashes. */
export function SyncBanner() {
  const { lastSyncAt, syncError, pendingOps } = useCompanion();
  return (
    <View style={s.bannerRow}>
      <Text style={[s.bannerText, syncError ? { color: T.brass } : null]} numberOfLines={1}>
        {syncError ? `${syncError} · ` : ""}synced {agoLabel(lastSyncAt)}
        {pendingOps.length > 0 ? ` · ${pendingOps.length} edit${pendingOps.length > 1 ? "s" : ""} pending` : ""}
      </Text>
    </View>
  );
}

/** 90-day sparkline: smooth jade/coral line with a soft gradient fill. */
export function Spark({ points, height = 64 }: { points: SparkPoint[]; height?: number }) {
  const [width, setWidth] = React.useState(0);
  if (points.length < 2) return null;

  const values = points.map((p) => p.cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const up = values[values.length - 1] >= values[0];
  const color = up ? T.jade : T.coral;

  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => 4 + (1 - (v - min) / range) * (height - 8);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <View style={{ height, marginTop: 12 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <SvgGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.22" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </SvgGradient>
          </Defs>
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={color} strokeWidth={1.8} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: T.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    padding: 18,
    marginBottom: 14,
    // --elev-2, translated: soft low ambient drop (inset highlight isn't a RN concept)
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 17,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  eyebrow: {
    fontFamily: F.sansSemiBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  pageHead: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: T.line,
    paddingBottom: 16,
    marginBottom: 18,
  },
  pageTitle: {
    fontFamily: F.display,
    color: T.paper,
    fontSize: 32,
    letterSpacing: -0.3,
    marginTop: 6,
  },
  bannerRow: { paddingVertical: 8, alignItems: "center" },
  bannerText: { color: T.faint, fontSize: 12, fontFamily: F.sans },
});

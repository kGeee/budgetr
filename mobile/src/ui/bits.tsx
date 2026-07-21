// Shared UI ported from the desktop's design system:
// Card (panel-2 → panel gradient, 18px radius, hairline border, soft drop),
// Eyebrow (brass editorial micro-label), PageHead (eyebrow date + Fraunces
// display title over a hairline), Aurora (the jade/brass atmospheric wash),
// SyncBanner, and an SVG sparkline.

import React from "react";
import { PanResponder, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Line, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import type { SparkPoint } from "@budgetr/core";
import { agoLabel, money } from "@/format";
import * as haptics from "@/haptics";
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

const scrubDate = (d: number) =>
  new Date(d * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * 90-day sparkline: smooth jade/coral line with a soft gradient fill, and
 * touch-scrubbable — drag across it to read any day's value. A light haptic
 * tick fires each time your finger crosses onto a new day, so the chart feels
 * detented like a physical dial.
 */
export function Spark({ points, height = 64 }: { points: SparkPoint[]; height?: number }) {
  const [width, setWidth] = React.useState(0);
  const [active, setActive] = React.useState<number | null>(null);
  const widthRef = React.useRef(0);
  const lastIdx = React.useRef(-1);

  // Landmark indexes get a heavier detent than ordinary days: the series'
  // min, max, and both endpoints answer "when was the peak?" by feel alone.
  const landmarks = React.useMemo(() => {
    if (points.length < 2) return new Set<number>();
    let lo = 0;
    let hi = 0;
    points.forEach((p, i) => {
      if (p.cents < points[lo]!.cents) lo = i;
      if (p.cents > points[hi]!.cents) hi = i;
    });
    return new Set([0, points.length - 1, lo, hi]);
  }, [points]);

  // Map a touch x within the chart to the nearest data-point index, ticking
  // haptically only when the index actually changes (not on every move event).
  const pick = React.useCallback(
    (locationX: number) => {
      const w = widthRef.current;
      if (w <= 0 || points.length < 2) return;
      const raw = Math.round((locationX / w) * (points.length - 1));
      const idx = Math.max(0, Math.min(points.length - 1, raw));
      if (idx !== lastIdx.current) {
        lastIdx.current = idx;
        if (landmarks.has(idx)) haptics.tap();
        else haptics.tick();
        setActive(idx);
      }
    },
    [points, landmarks],
  );

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          lastIdx.current = -1;
          pick(e.nativeEvent.locationX);
        },
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
        onPanResponderRelease: () => {
          lastIdx.current = -1;
          setActive(null);
        },
        onPanResponderTerminate: () => {
          lastIdx.current = -1;
          setActive(null);
        },
      }),
    [pick],
  );

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

  const ax = active !== null ? x(active) : 0;
  const ay = active !== null ? y(values[active]) : 0;
  // Keep the floating readout on-screen at both ends of the chart.
  const labelLeft = Math.max(0, Math.min(width - 96, ax - 48));

  return (
    <View
      style={{ height: height + 22, marginTop: 12 }}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        widthRef.current = w;
        setWidth(w);
      }}
      {...responder.panHandlers}
    >
      {active !== null && (
        <View style={[s.scrubLabel, { left: labelLeft }]} pointerEvents="none">
          <Text style={s.scrubValue}>{money(values[active])}</Text>
          <Text style={s.scrubDate}>{scrubDate(points[active].d)}</Text>
        </View>
      )}
      {width > 0 && (
        <Svg width={width} height={height} style={{ marginTop: 22 }}>
          <Defs>
            <SvgGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.22" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </SvgGradient>
          </Defs>
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={color} strokeWidth={1.8} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          {active !== null && (
            <>
              <Line x1={ax} y1={0} x2={ax} y2={height} stroke={T.lineStrong} strokeWidth={1} />
              <Circle cx={ax} cy={ay} r={4.5} fill={color} stroke={T.ink} strokeWidth={2} />
            </>
          )}
        </Svg>
      )}
    </View>
  );
}

/**
 * Daily-spend bar chart, scrubbable like Spark: brass bars, the active day
 * lights up ivory with a floating money+date readout and haptic detents.
 */
export function Bars({ points, height = 72 }: { points: SparkPoint[]; height?: number }) {
  const [width, setWidth] = React.useState(0);
  const [active, setActive] = React.useState<number | null>(null);
  const widthRef = React.useRef(0);
  const lastIdx = React.useRef(-1);

  const pick = React.useCallback(
    (locationX: number) => {
      const w = widthRef.current;
      if (w <= 0 || points.length === 0) return;
      const idx = Math.max(0, Math.min(points.length - 1, Math.floor((locationX / w) * points.length)));
      if (idx !== lastIdx.current) {
        lastIdx.current = idx;
        haptics.tick();
        setActive(idx);
      }
    },
    [points.length],
  );

  const responder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          lastIdx.current = -1;
          pick(e.nativeEvent.locationX);
        },
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
        onPanResponderRelease: () => {
          lastIdx.current = -1;
          setActive(null);
        },
        onPanResponderTerminate: () => {
          lastIdx.current = -1;
          setActive(null);
        },
      }),
    [pick],
  );

  if (points.length === 0) return null;

  const max = Math.max(1, ...points.map((p) => p.cents));
  const slot = width / points.length;
  const barW = Math.max(2, slot * 0.62);
  const pt = active !== null ? points[active] : null;
  const labelLeft = pt ? Math.max(0, Math.min(width - 96, active! * slot + slot / 2 - 48)) : 0;

  return (
    <View
      style={{ height: height + 22, marginTop: 12 }}
      onLayout={(e) => {
        widthRef.current = e.nativeEvent.layout.width;
        setWidth(e.nativeEvent.layout.width);
      }}
      {...responder.panHandlers}
    >
      {pt && (
        <View style={[s.scrubLabel, { left: labelLeft }]} pointerEvents="none">
          <Text style={s.scrubValue}>{money(pt.cents)}</Text>
          <Text style={s.scrubDate}>{scrubDate(pt.d)}</Text>
        </View>
      )}
      {width > 0 && (
        <Svg width={width} height={height} style={{ marginTop: 22 }}>
          {points.map((p, i) => {
            const h = Math.max(2, (p.cents / max) * (height - 6));
            return (
              <Rect
                key={p.d}
                x={i * slot + (slot - barW) / 2}
                y={height - h}
                width={barW}
                height={h}
                rx={Math.min(2, barW / 2)}
                fill={active === i ? T.paper : T.brass}
                opacity={active === null || active === i ? 0.92 : 0.45}
              />
            );
          })}
        </Svg>
      )}
    </View>
  );
}

/**
 * Allocation donut — the desktop's AllocationDonut, hand-drawn with SVG arcs
 * and the same PIE_COLORS. Hairline gaps between slices; the legend is the
 * caller's job (it needs layout the chart shouldn't own).
 */
export function Donut({ slices, size = 132 }: { slices: Array<{ cents: number; color: string }>; size?: number }) {
  const total = slices.reduce((a, sl) => a + Math.max(0, sl.cents), 0);
  if (total <= 0) return null;
  const r = size / 2;
  const inner = r * 0.62;

  let angle = -Math.PI / 2; // start at 12 o'clock
  const paths = slices
    .filter((sl) => sl.cents > 0)
    .map((sl, i) => {
      const sweep = (sl.cents / total) * Math.PI * 2;
      const a0 = angle;
      const a1 = angle + sweep;
      angle = a1;
      const large = sweep > Math.PI ? 1 : 0;
      const gap = Math.min(0.03, sweep / 4); // hairline gap, radians
      const s0 = a0 + gap / 2;
      const s1 = a1 - gap / 2;
      const d = [
        `M ${r + r * Math.cos(s0)} ${r + r * Math.sin(s0)}`,
        `A ${r} ${r} 0 ${large} 1 ${r + r * Math.cos(s1)} ${r + r * Math.sin(s1)}`,
        `L ${r + inner * Math.cos(s1)} ${r + inner * Math.sin(s1)}`,
        `A ${inner} ${inner} 0 ${large} 0 ${r + inner * Math.cos(s0)} ${r + inner * Math.sin(s0)}`,
        "Z",
      ].join(" ");
      return <Path key={i} d={d} fill={sl.color} />;
    });

  return (
    <Svg width={size} height={size}>
      {paths}
    </Svg>
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
  scrubLabel: { position: "absolute", top: 0, width: 96, alignItems: "center" },
  scrubValue: { color: T.paper, fontSize: 13, fontFamily: F.monoSemiBold },
  scrubDate: { color: T.faint, fontSize: 10, fontFamily: F.sans, marginTop: 1 },
});

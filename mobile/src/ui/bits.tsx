// Shared UI ported from the desktop's design system:
// Card (panel-2 → panel gradient, 18px radius, hairline border, soft drop),
// Eyebrow (brass editorial micro-label), PageHead (eyebrow date + Fraunces
// display title over a hairline), Aurora (the jade/brass atmospheric wash),
// SyncBanner, and an SVG sparkline.

import React from "react";
import { PanResponder, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Line, LinearGradient as SvgGradient, Path, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";
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

/**
 * KPI stat tiles — the reference's two/three-up mini-stat grid, as recessed
 * wells on a card: a small uppercase caption over a mono value. Tint colors
 * only the value (functional color, never the whole tile).
 */
export function StatRow({ items }: { items: { label: string; value: string; tint?: string }[] }) {
  return (
    <View style={s.statRow}>
      {items.map((it, i) => (
        <View key={i} style={s.statTile}>
          <Text style={s.statLabel} numberOfLines={1}>
            {it.label}
          </Text>
          <Text style={[s.statValue, it.tint ? { color: it.tint } : null]} numberOfLines={1} adjustsFontSizeToFit>
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Segmented control — the reference's pill toggle. A recessed track with a
 * single raised segment sliding to the selection; the caller owns the value.
 * A tick fires on change (never on re-selecting the active one).
 */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: V }[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <View style={s.segment}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              haptics.tick();
              onChange(o.value);
            }}
            style={[s.segItem, active && s.segItemActive]}
          >
            <Text style={[s.segText, active && s.segTextActive]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Striped meter — the reference's "Card Limits" bar: a solid fill up to `pct`,
 * a diagonal-hatched remainder in the same hue, and a paper thumb riding the
 * boundary. Reads as "how much of the allowance is used" at a glance.
 */
export function MeterBar({ pct, color, height = 12 }: { pct: number; color: string; height?: number }) {
  const [width, setWidth] = React.useState(0);
  const rid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const p = Math.max(0, Math.min(1, pct));
  const r = height / 2;
  const fillW = width * p;

  return (
    <View style={{ height, marginTop: 12 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <Pattern id={`hatch${rid}`} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <Line x1={0} y1={0} x2={0} y2={7} stroke={color} strokeWidth={2.4} opacity={0.4} />
            </Pattern>
          </Defs>
          {/* recessed track */}
          <Rect x={0} y={0} width={width} height={height} rx={r} fill={T.ink} />
          {/* hatched remainder */}
          <Rect x={0} y={0} width={width} height={height} rx={r} fill={`url(#hatch${rid})`} />
          {/* solid fill */}
          {fillW > 0 && <Rect x={0} y={0} width={Math.max(fillW, r * 2)} height={height} rx={r} fill={color} />}
          {/* thumb riding the boundary */}
          <Circle
            cx={Math.max(r, Math.min(width - r, fillW))}
            cy={r}
            r={r - 1.5}
            fill={T.paper}
            stroke={color}
            strokeWidth={2}
          />
        </Svg>
      )}
    </View>
  );
}

/** Desktop PageHead: eyebrow date, Fraunces display title, hairline below. */
export function PageHead({ title, action }: { title: string; action?: React.ReactNode }) {
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return (
    <View style={s.pageHead}>
      <View style={{ flex: 1 }}>
        <Eyebrow>{date}</Eyebrow>
        <Text style={s.pageTitle}>{title}</Text>
      </View>
      {action}
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

/** How long a "synced just now" confirmation stays up after a pull. */
const SYNC_CONFIRM_MS = 4000;

/**
 * Sync status — but only when it's worth saying.
 *
 * Errors, stale data and queued edits are STATES the user needs to know about,
 * so they show unconditionally: a glance app must never let stale numbers pass
 * as fresh (spec T6 stale-cache warning). The plain "synced Xm ago"
 * confirmation is different — it answers a question only someone who just
 * pulled to refresh is asking, so it appears for a few seconds after a manual
 * pull and stays out of the way otherwise.
 */
export function SyncBanner() {
  const { lastSyncAt, syncError, pendingOps, refreshing, manualSyncAt } = useCompanion();
  const [confirming, setConfirming] = React.useState(false);

  React.useEffect(() => {
    if (manualSyncAt === null) return;
    setConfirming(true);
    const id = setTimeout(() => setConfirming(false), SYNC_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [manualSyncAt]);

  const stale = lastSyncAt !== null && Date.now() / 1000 - lastSyncAt > 24 * 3600;
  const warn = Boolean(syncError) || stale;
  const pending = pendingOps.length > 0;
  // Nothing to report and nobody asked — render nothing rather than an empty row,
  // so the layout above doesn't reserve space for a message that isn't coming.
  if (!warn && !pending && !confirming && !refreshing) return null;

  const lead = syncError ? `${syncError} · ` : stale ? "⚠ showing old data · " : "";
  const synced = refreshing ? "syncing…" : confirming || warn ? `synced ${agoLabel(lastSyncAt)}` : "";
  const edits = pending ? `${synced ? " · " : ""}${pendingOps.length} edit${pendingOps.length > 1 ? "s" : ""} pending` : "";

  return (
    <View style={s.bannerRow}>
      <Text style={[s.bannerText, warn ? { color: T.brass } : null]} numberOfLines={1}>
        {lead}
        {synced}
        {edits}
      </Text>
    </View>
  );
}

/**
 * Sample-data ribbon. Sits above every tab whenever the app is showing the
 * fixture rather than a real desktop's summary.
 *
 * It is permanent and unmissable on purpose: a finance app quietly displaying
 * invented balances is the one failure mode worth spending vertical space to
 * prevent. Tapping it leaves — the same call that unpairs a real device, since
 * demo state and paired state are torn down identically.
 */
export function DemoRibbon() {
  const { demo, unpair } = useCompanion();
  if (!demo) return null;
  return (
    <Pressable
      style={s.ribbon}
      onPress={() => {
        haptics.tap();
        void unpair();
      }}
    >
      <Text style={s.ribbonText}>SAMPLE DATA — NOT YOUR ACCOUNTS</Text>
      <Text style={s.ribbonExit}>Exit</Text>
    </Pressable>
  );
}

/** Loading placeholder: breathing panel blocks instead of a blank screen. */
export function Skeleton() {
  const [pulse, setPulse] = React.useState(false);
  React.useEffect(() => {
    const id = setInterval(() => setPulse((p) => !p), 700);
    return () => clearInterval(id);
  }, []);
  const blocks = [140, 92, 220];
  return (
    <View style={{ flex: 1, backgroundColor: T.ink, padding: 18, paddingTop: 110 }}>
      {blocks.map((h, i) => (
        <View
          key={i}
          style={{
            height: h,
            borderRadius: T.radius,
            backgroundColor: pulse ? T.panel : T.panel2,
            marginBottom: 14,
            opacity: 0.8,
          }}
        />
      ))}
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
export function Donut({ slices, size = 132 }: { slices: { cents: number; color: string }[]; size?: number }) {
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

/**
 * Compact, non-interactive bars for tiles and sheets, where there's no room for
 * Bars' scrub readout. Days with no spend still take a slot so the rhythm of a
 * month reads correctly — gaps are the signal.
 */
export function MiniBars({
  points,
  height = 40,
  color = T.brass,
}: {
  points: SparkPoint[];
  height?: number;
  color?: string;
}) {
  const [width, setWidth] = React.useState(0);
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.cents));
  const slot = width / points.length;
  const barW = Math.max(1.5, slot * 0.58);

  return (
    <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {points.map((p, i) => {
            const h = Math.max(1.5, (p.cents / max) * (height - 2));
            return (
              <Rect
                key={p.d}
                x={i * slot + (slot - barW) / 2}
                y={height - h}
                width={barW}
                height={h}
                rx={Math.min(1.5, barW / 2)}
                fill={color}
                opacity={0.85}
              />
            );
          })}
        </Svg>
      )}
    </View>
  );
}

/**
 * Cumulative spend against the even-pace line — the same reading as the Home
 * Screen widget, so the two never disagree. Jade while under pace, coral once
 * the solid line crosses above the dashes.
 */
export function PaceLine({
  cumulative,
  limitCents,
  daysInMonth,
  dayOfMonth,
  height = 96,
}: {
  cumulative: number[];
  limitCents: number;
  daysInMonth: number;
  dayOfMonth: number;
  height?: number;
}) {
  const [width, setWidth] = React.useState(0);
  const rid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  if (cumulative.length < 2) return null;

  const spent = cumulative[cumulative.length - 1];
  // No budget set? Pace against the month's own run rate instead, so the chart
  // still has a reference line rather than silently dropping it.
  const target = limitCents > 0 ? limitCents : Math.round((spent / Math.max(1, dayOfMonth)) * daysInMonth);
  const paceToDate = Math.round((target * dayOfMonth) / daysInMonth);
  const ahead = spent > paceToDate;
  const color = ahead ? T.coral : T.jade;
  const yMax = Math.max(target, spent, 1);

  const x = (i: number) => (i / Math.max(1, daysInMonth - 1)) * width;
  const y = (v: number) => 3 + (1 - v / yMax) * (height - 6);
  const line = cumulative.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(cumulative.length - 1).toFixed(1)},${height} L0,${height} Z`;

  return (
    <View style={{ height, marginTop: 12 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <SvgGradient id={`pace${rid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.24" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </SvgGradient>
          </Defs>
          {/* even-pace guide: 0 → the month's target across every day */}
          <Line
            x1={0}
            y1={y(0)}
            x2={width}
            y2={y(target)}
            stroke={T.faint}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <Path d={area} fill={`url(#pace${rid})`} />
          <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={x(cumulative.length - 1)} cy={y(spent)} r={3.5} fill={color} stroke={T.ink} strokeWidth={1.5} />
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
  statRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  statTile: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    backgroundColor: "rgba(8,11,10,0.5)",
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  statLabel: {
    color: T.faint,
    fontFamily: F.sansSemiBold,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  statValue: { color: T.paper, fontFamily: F.monoSemiBold, fontSize: 17, marginTop: 6 },
  segment: {
    flexDirection: "row",
    backgroundColor: T.ink,
    borderRadius: 999,
    padding: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
  },
  segItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 999,
  },
  segItemActive: {
    backgroundColor: T.panel2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.lineStrong,
  },
  segText: { color: T.muted, fontFamily: F.sansSemiBold, fontSize: 12.5 },
  segTextActive: { color: T.paper },
  pageHead: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
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
  ribbon: {
    // Overlaid rather than stacked, the same way the floating tab bar is: every
    // screen already reserves ~92-110px of top padding, so the ribbon lands in
    // space that was empty instead of pushing each layout down by its height.
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: T.brassDim,
    paddingTop: 62, // clears the notch
    paddingBottom: 7,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  ribbonText: { color: T.ink, fontSize: 10.5, fontFamily: F.sansSemiBold, letterSpacing: 1.1 },
  ribbonExit: { color: T.ink, fontSize: 11, fontFamily: F.sansSemiBold, textDecorationLine: "underline" },
  scrubLabel: { position: "absolute", top: 0, width: 96, alignItems: "center" },
  scrubValue: { color: T.paper, fontSize: 13, fontFamily: F.monoSemiBold },
  scrubDate: { color: T.faint, fontSize: 10, fontFamily: F.sans, marginTop: 1 },
});

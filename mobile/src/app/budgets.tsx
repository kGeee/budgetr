// Budgets — one bar per category, colored by the desktop-computed state
// (jade / brass / coral, matching the desktop's ok / warn / over semantics).
// Tap a budget to see its transactions from `recent`.

import React, { useCallback, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, Line, LinearGradient as SvgGradient, Path, Circle, Stop } from "react-native-svg";
import type { BudgetSummary, SparkPoint } from "@budgetr/core";
import { categoryLabel, money } from "@/format";
import * as haptics from "@/haptics";
import { F, stateColor, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Card, Eyebrow, PageHead, SyncBanner } from "@/ui/bits";

/**
 * The desktop Budgets page's pace chart, phone-sized: cumulative month spend
 * against the dashed "even pace" line to the total budget. The spent line is
 * jade while under pace, coral once ahead of it; scrubbing reads any day's
 * cumulative total with haptic detents (today and day 1 tap harder).
 */
function PaceChart({ spendByDay, budgets }: { spendByDay: SparkPoint[]; budgets: BudgetSummary[] }) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const widthRef = useRef(0);
  const lastIdx = useRef(-1);

  const height = 96;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = Math.min(now.getDate(), daysInMonth);
  const totalLimit = budgets.reduce((a, b) => a + b.limitCents, 0);

  // Cumulative spend per day-of-month, from the synced daily series.
  const cum = useMemo(() => {
    const monthStart = Date.UTC(now.getFullYear(), now.getMonth(), 1) / 1000;
    const byDay = new Map<number, number>();
    for (const p of spendByDay) {
      if (p.d < monthStart) continue;
      const dayOfMonth = new Date(p.d * 1000).getUTCDate();
      byDay.set(dayOfMonth, (byDay.get(dayOfMonth) ?? 0) + p.cents);
    }
    const out: number[] = [];
    let run = 0;
    for (let d = 1; d <= today; d++) {
      run += byDay.get(d) ?? 0;
      out.push(run);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendByDay, today]);

  const pick = useCallback(
    (locationX: number) => {
      const w = widthRef.current;
      if (w <= 0 || cum.length === 0) return;
      // The scrubbable region is the elapsed part of the month only.
      const elapsedW = (today / daysInMonth) * w;
      const idx = Math.max(0, Math.min(today - 1, Math.round((locationX / elapsedW) * (today - 1))));
      if (idx !== lastIdx.current) {
        lastIdx.current = idx;
        if (idx === 0 || idx === today - 1) haptics.tap();
        else haptics.tick();
        setActive(idx);
      }
    },
    [cum.length, today, daysInMonth],
  );

  const responder = useMemo(
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

  if (totalLimit <= 0 || cum.length === 0) return null;

  const spentToDate = cum[cum.length - 1]!;
  const paceToDate = Math.round((totalLimit * today) / daysInMonth);
  const ahead = spentToDate > paceToDate; // ahead of pace = spending too fast
  const lineColor = ahead ? T.coral : T.jade;
  const left = totalLimit - spentToDate;
  const projected = today > 0 ? Math.round((spentToDate / today) * daysInMonth) : 0;

  const yMax = Math.max(totalLimit, spentToDate) * 1.05;
  const x = (day: number) => ((day - 1) / (daysInMonth - 1)) * width;
  const y = (v: number) => 4 + (1 - v / yMax) * (height - 8);
  const spentPath = cum.map((v, i) => `${i === 0 ? "M" : "L"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const spentArea = `${spentPath} L${x(today)},${height} L0,${height} Z`;
  const ax = active !== null ? x(active + 1) : 0;
  const labelLeft = Math.max(0, Math.min(width - 96, ax - 48));
  const monthLabel = now.toLocaleDateString("en-US", { month: "long" });

  return (
    <Card>
      <View style={pc.head}>
        <View>
          <Eyebrow color={left < 0 ? T.coral : T.brass}>{left < 0 ? "Over budget" : "Left to spend"}</Eyebrow>
          <Text style={[pc.big, left < 0 && { color: T.coral }]}>{money(Math.abs(left))}</Text>
          <Text style={pc.sub}>
            {money(spentToDate)} of {money(totalLimit)} · {monthLabel}
          </Text>
        </View>
        <View style={pc.legend}>
          <View style={pc.legendRow}>
            <View style={[pc.dot, { backgroundColor: lineColor }]} />
            <Text style={pc.legendText}>Spent</Text>
          </View>
          <View style={pc.legendRow}>
            <View style={[pc.dash]} />
            <Text style={pc.legendText}>Pace</Text>
          </View>
        </View>
      </View>

      <View
        style={{ height: height + 22, marginTop: 4 }}
        onLayout={(e) => {
          widthRef.current = e.nativeEvent.layout.width;
          setWidth(e.nativeEvent.layout.width);
        }}
        {...responder.panHandlers}
      >
        {active !== null && (
          <View style={[pc.scrubLabel, { left: labelLeft }]} pointerEvents="none">
            <Text style={pc.scrubValue}>{money(cum[active]!)}</Text>
            <Text style={pc.scrubDate}>
              {monthLabel.slice(0, 3)} {active + 1}
            </Text>
          </View>
        )}
        {width > 0 && (
          <Svg width={width} height={height} style={{ marginTop: 22 }}>
            <Defs>
              <SvgGradient id="paceFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={lineColor} stopOpacity="0.2" />
                <Stop offset="1" stopColor={lineColor} stopOpacity="0" />
              </SvgGradient>
            </Defs>
            {/* even-pace guide: 0 → total budget across the whole month */}
            <Line
              x1={0}
              y1={y(0)}
              x2={width}
              y2={y(totalLimit)}
              stroke={T.faint}
              strokeWidth={1.2}
              strokeDasharray="4 4"
            />
            <Path d={spentArea} fill="url(#paceFill)" />
            <Path d={spentPath} stroke={lineColor} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {active !== null && (
              <>
                <Line x1={ax} y1={0} x2={ax} y2={height} stroke={T.lineStrong} strokeWidth={1} />
                <Circle cx={ax} cy={y(cum[active]!)} r={4.5} fill={lineColor} stroke={T.ink} strokeWidth={2} />
              </>
            )}
          </Svg>
        )}
      </View>
      <Text style={pc.projection}>
        Projected {money(projected)} by month end{" "}
        {projected > totalLimit ? <Text style={{ color: T.coral }}>· over by {money(projected - totalLimit)}</Text> : null}
      </Text>
    </Card>
  );
}

const pc = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  big: { color: T.paper, fontSize: 30, fontFamily: F.display, letterSpacing: -0.5, marginTop: 6 },
  sub: { color: T.muted, fontSize: 12.5, fontFamily: F.sans, marginTop: 4 },
  legend: { gap: 6, alignItems: "flex-end" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dash: { width: 12, height: 0, borderTopWidth: 1.5, borderColor: T.faint, borderStyle: "dashed" },
  legendText: { color: T.muted, fontSize: 11.5, fontFamily: F.sans },
  scrubLabel: { position: "absolute", top: 0, width: 96, alignItems: "center" },
  scrubValue: { color: T.paper, fontSize: 13, fontFamily: F.monoSemiBold },
  scrubDate: { color: T.faint, fontSize: 10, fontFamily: F.sans, marginTop: 1 },
  projection: { color: T.muted, fontSize: 12, fontFamily: F.sans, marginTop: 10 },
});

export default function Budgets() {
  const { summary, refresh, refreshing } = useCompanion();
  const [openCat, setOpenCat] = useState<string | null>(null);

  const budgets = summary?.budgets ?? [];

  return (
    <View style={s.root}>
      <Aurora />
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              haptics.thud();
              void refresh();
            }}
            tintColor={T.muted}
          />
        }
      >
        <PageHead title="Budgets" />
        <SyncBanner />
        <PaceChart spendByDay={summary?.spendByDay ?? []} budgets={budgets} />
        {budgets.length === 0 && <Text style={s.emptyText}>No budgets set — add limits on your Mac.</Text>}

        {budgets.map((b) => {
          const pct = b.limitCents > 0 ? Math.min(1, b.spentCents / b.limitCents) : 1;
          const color = stateColor[b.state];
          const open = openCat === b.category;
          const txns = open ? (summary?.recent ?? []).filter((t) => t.category === b.category) : [];
          return (
            <Pressable
              key={b.category}
              onPress={() => {
                haptics.tick();
                setOpenCat(open ? null : b.category);
              }}
            >
              <Card>
                <View style={s.head}>
                  <Text style={s.name}>{categoryLabel(b.category)}</Text>
                  <Text style={s.amounts}>
                    <Text style={[s.spent, { color }]}>{money(b.spentCents)}</Text>
                    <Text style={s.limit}> / {money(b.limitCents)}</Text>
                  </Text>
                </View>
                <View style={s.track}>
                  <View style={[s.fill, { width: `${pct * 100}%`, backgroundColor: color }]} />
                </View>
                {b.state !== "ok" && (
                  <Text style={[s.stateNote, { color }]}>
                    {b.state === "over" ? "Over budget" : "Approaching limit"}
                  </Text>
                )}
                {open && (
                  <View style={s.txns}>
                    {txns.length === 0 ? (
                      <Text style={s.txnEmpty}>No recent transactions in this category.</Text>
                    ) : (
                      txns.map((t) => (
                        <View key={t.id} style={s.txnRow}>
                          <Text style={s.txnName} numberOfLines={1}>
                            {t.merchant}
                          </Text>
                          <Text style={s.txnAmt}>{money(t.cents)}</Text>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  content: { padding: 18, paddingTop: 74, paddingBottom: 44 },
  emptyText: { color: T.muted, textAlign: "center", marginTop: 60, fontSize: 14, fontFamily: F.sans },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  name: { color: T.paper, fontSize: 15.5, fontFamily: F.sansSemiBold, flexShrink: 1 },
  amounts: { fontSize: 13 },
  spent: { fontFamily: F.monoSemiBold },
  limit: { color: T.faint, fontFamily: F.mono },
  track: { height: 7, borderRadius: 4, backgroundColor: T.ink, marginTop: 12, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
  stateNote: {
    fontSize: 10.5,
    marginTop: 8,
    fontFamily: F.sansSemiBold,
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  txns: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line, paddingTop: 6 },
  txnEmpty: { color: T.faint, fontSize: 12, paddingVertical: 6, fontFamily: F.sans },
  txnRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, gap: 12 },
  txnName: { color: T.muted, fontSize: 13, flex: 1, fontFamily: F.sans },
  txnAmt: { color: T.muted, fontSize: 13, fontFamily: F.mono },
});

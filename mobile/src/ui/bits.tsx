// Tiny shared UI pieces — panels, section labels, sync banner, sparkline bars.

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { SparkPoint } from "@budgetr/core";
import { agoLabel } from "@/format";
import { T } from "@/theme";
import { useCompanion } from "@/state/companion";

export function Panel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.panel, style]}>{children}</View>;
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={s.section}>{children}</Text>;
}

/** "Last synced Xm ago" + error state — spec §8: errors are states, not crashes. */
export function SyncBanner() {
  const { lastSyncAt, syncError, pendingOps } = useCompanion();
  return (
    <View style={s.bannerRow}>
      <Text style={[s.bannerText, syncError ? s.bannerErr : null]} numberOfLines={1}>
        {syncError ? `⚠ ${syncError} · ` : ""}synced {agoLabel(lastSyncAt)}
        {pendingOps.length > 0 ? ` · ${pendingOps.length} edit${pendingOps.length > 1 ? "s" : ""} pending` : ""}
      </Text>
    </View>
  );
}

/** 90-day net-worth sparkline as flex bars — no chart dependency needed. */
export function Spark({ points }: { points: SparkPoint[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const up = values[values.length - 1] >= values[0];
  return (
    <View style={s.spark}>
      {points.map((p) => (
        <View
          key={p.d}
          style={{
            flex: 1,
            marginHorizontal: 0.5,
            borderRadius: 1,
            height: `${8 + ((p.cents - min) / range) * 92}%`,
            backgroundColor: up ? T.jade : T.coral,
            opacity: 0.75,
          }}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  panel: {
    backgroundColor: T.panel,
    borderColor: T.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  section: {
    color: T.muted,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 4,
  },
  bannerRow: { paddingVertical: 6, alignItems: "center" },
  bannerText: { color: T.muted, fontSize: 12 },
  bannerErr: { color: T.amber },
  spark: { height: 56, flexDirection: "row", alignItems: "flex-end", marginTop: 10 },
});

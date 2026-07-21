// Holdings — the Investments page's greatest hits, phone-sized: portfolio
// value over a scrubbable chart, sector allocation donut, topical options
// strategies (soonest expiry first, DTE-colored), and the positions list.
// Still read-only, still no basis/greeks/lots — the Mac has the detail.

import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { money, moneyCompact } from "@/format";
import * as haptics from "@/haptics";
import { F, PIE_COLORS, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Card, Donut, Eyebrow, PageHead, Spark, SyncBanner } from "@/ui/bits";

function dteLabel(expiry: number): { text: string; color: string } {
  const days = Math.floor((expiry - Date.now() / 1000) / 86_400);
  if (days < 0) return { text: "expired", color: T.faint };
  if (days === 0) return { text: "today", color: T.coral };
  if (days <= 7) return { text: `${days}d`, color: T.coral };
  if (days <= 21) return { text: `${days}d`, color: T.brass };
  return { text: `${days}d`, color: T.muted };
}

export default function Holdings() {
  const { summary, refresh, refreshing } = useCompanion();
  const positions = summary?.positions ?? [];
  const inv = summary?.investments;
  const total = inv?.valueCents ?? positions.reduce((acc, p) => acc + p.cents, 0);

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
        <PageHead title="Holdings" />
        <SyncBanner />

        {positions.length === 0 ? (
          <Text style={s.emptyText}>No positions synced.</Text>
        ) : (
          <>
            <Card style={s.hero}>
              <Eyebrow>Portfolio value</Eyebrow>
              <Text style={s.heroValue}>{money(total)}</Text>
              {inv && inv.spark.length > 1 && <Spark points={inv.spark} height={72} />}
            </Card>

            {inv && inv.sectors.length > 0 && (
              <Card>
                <Eyebrow>Allocation by sector</Eyebrow>
                <View style={s.allocRow}>
                  <Donut
                    slices={inv.sectors.map((sl, i) => ({ cents: sl.cents, color: PIE_COLORS[i % PIE_COLORS.length]! }))}
                  />
                  <View style={s.legend}>
                    {inv.sectors.map((sl, i) => {
                      const sectorTotal = inv.sectors.reduce((a, x) => a + x.cents, 0);
                      const pct = sectorTotal > 0 ? Math.round((sl.cents / sectorTotal) * 100) : 0;
                      return (
                        <View key={sl.sector} style={s.legendRow}>
                          <View style={[s.legendDot, { backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }]} />
                          <Text style={s.legendName} numberOfLines={1}>
                            {sl.sector}
                          </Text>
                          <Text style={s.legendPct}>{pct}%</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </Card>
            )}

            {inv && inv.strategies.length > 0 && (
              <Card>
                <Eyebrow>Options · topical</Eyebrow>
                <View style={{ marginTop: 6 }}>
                  {inv.strategies.map((st, i) => {
                    const dte = dteLabel(st.expiry);
                    return (
                      <View key={st.id} style={[s.stratRow, i > 0 && s.rowBorder]}>
                        <View style={{ flex: 1 }}>
                          <View style={s.stratHead}>
                            <Text style={s.stratUnderlying}>{st.underlying}</Text>
                            <Text style={s.stratLabel} numberOfLines={1}>
                              {st.label}
                            </Text>
                          </View>
                          <Text style={s.stratDetail} numberOfLines={1}>
                            {st.detail}
                          </Text>
                        </View>
                        <View style={s.stratRight}>
                          <Text style={[s.dte, { color: dte.color, borderColor: dte.color }]}>{dte.text}</Text>
                          <Text style={[s.stratValue, st.cents < 0 && { color: T.coral }]}>{moneyCompact(st.cents)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            <Card>
              <Eyebrow>Positions</Eyebrow>
              <View style={{ marginTop: 6 }}>
                {positions.map((p, i) => {
                  const posTotal = positions.reduce((a, x) => a + Math.max(0, x.cents), 0);
                  const pct = posTotal > 0 ? (Math.max(0, p.cents) / posTotal) * 100 : 0;
                  return (
                    <View key={p.symbol} style={[s.posRow, i > 0 && s.rowBorder]}>
                      <View style={s.posHead}>
                        <Text style={s.symbol}>{p.symbol}</Text>
                        <Text style={s.posPct}>{pct >= 1 ? `${pct.toFixed(1)}%` : "<1%"}</Text>
                        <Text style={s.value}>{moneyCompact(p.cents)}</Text>
                      </View>
                      <View style={s.barWrap}>
                        <View style={[s.bar, { width: `${Math.max(1.5, pct)}%` }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            </Card>
            <Text style={s.footnote}>Cost basis, lots, and gains live on your Mac.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink },
  content: { padding: 18, paddingTop: 74, paddingBottom: 44 },
  emptyText: { color: T.muted, textAlign: "center", marginTop: 60, fontSize: 14, fontFamily: F.sans },
  hero: { paddingVertical: 22 },
  heroValue: { color: T.paper, fontSize: 36, fontFamily: F.display, letterSpacing: -0.6, marginTop: 8 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },

  allocRow: { flexDirection: "row", alignItems: "center", gap: 18, marginTop: 14 },
  legend: { flex: 1, gap: 6 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { color: T.muted, fontSize: 12.5, fontFamily: F.sans, flex: 1 },
  legendPct: { color: T.paper, fontSize: 12.5, fontFamily: F.mono },

  stratRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11 },
  stratHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  stratUnderlying: { color: T.paper, fontSize: 14, fontFamily: F.monoSemiBold },
  stratLabel: { color: T.paper, fontSize: 13.5, fontFamily: F.sansMedium, flexShrink: 1 },
  stratDetail: { color: T.faint, fontSize: 12, fontFamily: F.mono, marginTop: 3 },
  stratRight: { alignItems: "flex-end", gap: 4 },
  dte: {
    fontSize: 10.5,
    fontFamily: F.sansSemiBold,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
    overflow: "hidden",
  },
  stratValue: { color: T.paper, fontSize: 13, fontFamily: F.mono },

  posRow: { paddingVertical: 10 },
  posHead: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  symbol: { color: T.paper, fontSize: 13.5, fontFamily: F.monoSemiBold, flex: 1 },
  posPct: { color: T.faint, fontSize: 11.5, fontFamily: F.mono },
  value: { color: T.paper, fontSize: 13.5, fontFamily: F.mono, minWidth: 70, textAlign: "right" },
  barWrap: { height: 4, borderRadius: 2, backgroundColor: T.ink, overflow: "hidden", marginTop: 7 },
  bar: { height: "100%", backgroundColor: T.brass, borderRadius: 2 },

  footnote: { color: T.faint, fontSize: 12, textAlign: "center", marginTop: 12, fontFamily: F.sans },
});

// Spending — the glance surface, sized to one screen.
//
// Everything answers "where is my money going this month?": the month-to-date
// hero with a like-for-like delta, one chart slot that switches between daily
// bars / cumulative pace / category mix, and a grid of categories you tap into.
// Nothing scrolls — the page is a fixed column and the long lists live in
// sheets. Net worth, accounts and alerts moved behind the wallet chip; the gear
// still holds Settings.

import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeOut, LinearTransition, useReducedMotion } from "react-native-reanimated";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Constants from "expo-constants";
import { Settings2, Wallet } from "lucide-react-native";
import { agoLabel, dayLabel, money, moneyCompact } from "@/format";
import { CategoryIcon, categoryIndex } from "@/categories";
import {
  categoryByDay,
  categorySpend,
  categoryTxns,
  mixSlices,
  monthTotals,
  monthWindow,
  type CategorySpend,
} from "@/spending";
import * as haptics from "@/haptics";
import { F, PIE_COLORS, stateColor, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Bars, Card, Donut, Eyebrow, MeterBar, MiniBars, PaceLine, Segmented, Spark } from "@/ui/bits";
import { AnimatedMoney, PressableScale, useEntering } from "@/ui/motion";
import { FixedScreen } from "@/ui/screen";
import { Sheet } from "@/ui/sheet";

const CHART_H = 128; // one height for every mode, so switching never reflows
const TILES = 6; // what fits above the tab pill without scrolling

type ChartMode = "daily" | "pace" | "mix";

const CHART_MODES = [
  { label: "Daily", value: "daily" as const },
  { label: "Pace", value: "pace" as const },
  { label: "Mix", value: "mix" as const },
];

// ── Category tile ────────────────────────────────────────────────────

function CategoryTile({ row, index, onPress }: { row: CategorySpend; index: number; onPress: () => void }) {
  const entering = useEntering();
  const pct = row.budget && row.budget.limitCents > 0 ? row.cents / row.budget.limitCents : null;
  const tint = row.budget ? stateColor[row.budget.state] : T.brass;

  return (
    <Animated.View entering={entering(index)} style={ct.wrap}>
      <PressableScale
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        style={ct.tile}
      >
        <View style={ct.head}>
          <CategoryIcon icon={row.icon} size={14} color={tint} />
          <Text style={ct.name} numberOfLines={1}>
            {row.name}
          </Text>
        </View>
        <Text style={ct.amount} numberOfLines={1} adjustsFontSizeToFit>
          {moneyCompact(row.cents)}
        </Text>
        {pct !== null ? (
          <>
            <View style={ct.track}>
              <View style={[ct.fill, { width: `${Math.min(100, pct * 100)}%`, backgroundColor: tint }]} />
            </View>
            <Text style={ct.sub} numberOfLines={1}>
              {Math.round(pct * 100)}% of {moneyCompact(row.budget!.limitCents)}
            </Text>
          </>
        ) : (
          <Text style={[ct.sub, ct.subLoose]} numberOfLines={1}>
            {row.partial ? "recent only" : "no budget"}
          </Text>
        )}
      </PressableScale>
    </Animated.View>
  );
}

// ── Sheets ───────────────────────────────────────────────────────────

/** One category: its month, its budget, its transactions. */
function CategorySheet({ row, onClose }: { row: CategorySpend | null; onClose: () => void }) {
  const { summary } = useCompanion();
  const win = useMemo(() => monthWindow(), []);
  const txns = useMemo(() => (row ? categoryTxns(summary, row.id, win) : []), [summary, row, win]);
  const byDay = useMemo(() => categoryByDay(txns), [txns]);

  const tint = row?.budget ? stateColor[row.budget.state] : T.brass;
  const pct = row?.budget && row.budget.limitCents > 0 ? row.cents / row.budget.limitCents : null;

  return (
    <Sheet visible={row !== null} onClose={onClose}>
      {row === null ? null : (
      <>
      <View style={cs.head}>
        <CategoryIcon icon={row.icon} size={17} color={tint} />
        <Text style={cs.title}>{row.name}</Text>
      </View>
      <Text style={cs.hero}>{money(row.cents)}</Text>
      <Text style={cs.heroSub}>
        this month
        {row.partial ? " · from recent transactions only" : ""}
      </Text>

      {pct !== null && (
        <>
          <MeterBar pct={pct} color={tint} />
          <Text style={cs.meterSub}>
            {money(row.cents)} of {money(row.budget!.limitCents)} ·{" "}
            {row.cents > row.budget!.limitCents
              ? `${money(row.cents - row.budget!.limitCents)} over`
              : `${money(row.budget!.limitCents - row.cents)} left`}
          </Text>
        </>
      )}

      {byDay.length > 1 && (
        <View style={cs.chart}>
          <Eyebrow>By day</Eyebrow>
          <View style={{ marginTop: 10 }}>
            <MiniBars points={byDay} height={44} color={tint} />
          </View>
        </View>
      )}

      <Text style={cs.section}>
        {txns.length} TRANSACTION{txns.length === 1 ? "" : "S"}
      </Text>
      <ScrollView style={{ maxHeight: 260 }}>
        {txns.map((t, i) => (
          <View key={t.id} style={[cs.txn, i > 0 && cs.txnBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={cs.merchant} numberOfLines={1}>
                {t.merchant}
              </Text>
              <Text style={cs.txnMeta}>
                {dayLabel(t.ts)}
                {t.pending ? " · pending" : ""}
              </Text>
            </View>
            <Text style={cs.txnAmount}>{money(t.cents)}</Text>
          </View>
        ))}
        {txns.length === 0 && <Text style={cs.empty}>Nothing on the recent tape for this month.</Text>}
      </ScrollView>
      </>
      )}
    </Sheet>
  );
}

/** Every category, not just the six that fit on the page. */
function AllCategoriesSheet({
  visible,
  rows,
  total,
  onClose,
  onPick,
}: {
  visible: boolean;
  rows: CategorySpend[];
  total: number;
  onClose: () => void;
  onPick: (row: CategorySpend) => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={cs.title}>All categories</Text>
      <Text style={cs.heroSub}>{money(total)} this month</Text>
      <ScrollView style={{ maxHeight: 460, marginTop: 12 }}>
        {rows.map((r, i) => {
          const tint = r.budget ? stateColor[r.budget.state] : T.brass;
          const share = total > 0 ? r.cents / total : 0;
          return (
            <Pressable
              key={r.id}
              style={[cs.allRow, i > 0 && cs.txnBorder]}
              onPress={() => {
                haptics.tap();
                onPick(r);
              }}
            >
              <CategoryIcon icon={r.icon} size={15} color={tint} />
              <View style={{ flex: 1 }}>
                <Text style={cs.merchant} numberOfLines={1}>
                  {r.name}
                </Text>
                <View style={cs.allTrack}>
                  <View style={[cs.allFill, { width: `${Math.max(2, share * 100)}%`, backgroundColor: tint }]} />
                </View>
              </View>
              <Text style={cs.txnAmount}>{money(r.cents)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

/** Net worth, accounts and alerts — off the main page, one tap away. */
function WalletSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { summary, dismissAlert } = useCompanion();
  const reduced = useReducedMotion();

  const assets = (summary?.accounts ?? []).reduce((a, x) => a + Math.max(0, x.cents), 0);
  const debts = (summary?.accounts ?? []).reduce((a, x) => a + Math.max(0, -x.cents), 0);

  return (
    <Sheet visible={visible && summary !== null} onClose={onClose}>
      {summary === null ? null : (
      <>
      <Eyebrow>Net worth</Eyebrow>
      <Text style={cs.hero}>{money(summary.netWorth.cents)}</Text>
      <Spark points={summary.netWorth.spark} height={84} />
      <Text style={cs.meterSub}>
        {moneyCompact(assets)} assets · {moneyCompact(debts)} debts
      </Text>

      {summary.alerts.length > 0 && (
        <>
          <Text style={cs.section}>ALERTS · SWIPE TO DISMISS</Text>
          {summary.alerts.map((a, i) => (
            <Animated.View
              key={`${a.id}-${i}`}
              exiting={FadeOut.duration(180)}
              layout={reduced ? undefined : LinearTransition.springify().stiffness(320).damping(42)}
            >
              <ReanimatedSwipeable
                friction={1.6}
                rightThreshold={52}
                overshootRight={false}
                renderRightActions={() => (
                  <View style={cs.swipeZone}>
                    <Text style={cs.swipeZoneText}>Dismiss</Text>
                  </View>
                )}
                onSwipeableWillOpen={() => {
                  haptics.success();
                  dismissAlert(a.id);
                }}
              >
                <View style={cs.alert}>
                  <Text style={cs.alertText}>{a.text}</Text>
                </View>
              </ReanimatedSwipeable>
            </Animated.View>
          ))}
        </>
      )}

      <Text style={cs.section}>ACCOUNTS</Text>
      <ScrollView style={{ maxHeight: 260 }}>
        {summary.accounts.map((a, i) => (
          <View key={a.id} style={[cs.txn, i > 0 && cs.txnBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={cs.merchant} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={cs.txnMeta}>{a.kind}</Text>
            </View>
            <Text style={[cs.txnAmount, a.cents < 0 && { color: T.coral }]}>{moneyCompact(a.cents)}</Text>
          </View>
        ))}
      </ScrollView>
      </>
      )}
    </Sheet>
  );
}

function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { lastSyncAt, refresh, unpair, syncError, widget } = useCompanion();
  const [confirming, setConfirming] = useState(false);
  const w = widgetLabel(widget);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={st.title}>Settings</Text>
      <Text style={st.sub}>COMPANION</Text>

      <View style={st.row}>
        <Text style={st.rowLabel}>Last sync</Text>
        <Text style={st.rowValue}>{agoLabel(lastSyncAt)}</Text>
      </View>
      <View style={st.row}>
        <Text style={st.rowLabel}>Status</Text>
        <Text style={[st.rowValue, { color: syncError ? T.brass : T.jade }]}>{syncError ?? "healthy"}</Text>
      </View>
      <View style={st.row}>
        <Text style={st.rowLabel}>Widget</Text>
        <Text style={[st.rowValue, { color: w.ok ? T.jade : T.brass }]}>{w.text}</Text>
      </View>
      <View style={st.row}>
        <Text style={st.rowLabel}>Version</Text>
        <Text style={st.rowValue}>{Constants.expoConfig?.version ?? "dev"}</Text>
      </View>

      <Text style={st.privacy}>
        Your Mac is the source of truth. This phone holds an end-to-end encrypted snapshot — the
        relay in between can never read it, and nothing here can be recovered without your devices.
      </Text>

      <Pressable
        style={st.action}
        onPress={() => {
          haptics.thud();
          void refresh({ manual: true }); // explicitly asked for → worth confirming
        }}
      >
        <Text style={st.actionText}>Sync now</Text>
      </Pressable>

      <Pressable
        style={[st.action, st.danger]}
        onPress={() => {
          if (!confirming) {
            haptics.warning();
            setConfirming(true);
            setTimeout(() => setConfirming(false), 3000); // easy escape — it just reverts
          } else {
            haptics.error();
            onClose();
            void unpair();
          }
        }}
      >
        <Text style={[st.actionText, { color: T.coral }]}>
          {confirming ? "Tap again to unpair — this phone forgets everything" : "Unpair this phone"}
        </Text>
      </Pressable>
    </Sheet>
  );
}

/** Home/Lock Screen widget health — the widget itself can only say "open the app". */
function widgetLabel(w: ReturnType<typeof useCompanion>["widget"]): { text: string; ok: boolean } {
  switch (w.state) {
    case "published":
      return { text: `updated ${agoLabel(w.at)}`, ok: true };
    case "unavailable":
      return {
        text: w.reason === "expo-go" ? "not in Expo Go — needs a dev build" : "missing from this build — rebuild",
        ok: false,
      };
    case "failed":
      return { text: w.detail, ok: false };
    default:
      return { text: "waiting for a sync", ok: true };
  }
}

// ── Page ─────────────────────────────────────────────────────────────

export default function Spending() {
  const { summary, refresh, refreshing } = useCompanion();
  const entering = useEntering();
  const [mode, setMode] = useState<ChartMode>("daily");
  const [openCat, setOpenCat] = useState<CategorySpend | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const win = useMemo(() => monthWindow(), []);
  const catIndex = useMemo(() => categoryIndex(summary), [summary]);
  const totals = useMemo(() => monthTotals(summary?.spendByDay ?? [], win), [summary, win]);
  const rows = useMemo(() => categorySpend(summary, catIndex, win), [summary, catIndex, win]);
  const monthDays = useMemo(
    () => (summary?.spendByDay ?? []).filter((p) => p.d >= win.startSec),
    [summary, win],
  );
  const totalLimit = useMemo(
    () => (summary?.budgets ?? []).reduce((a, b) => a + b.limitCents, 0),
    [summary],
  );

  const up = (totals.deltaPct ?? 0) > 0;
  const hasAlerts = (summary?.alerts.length ?? 0) > 0;

  if (!summary) {
    return (
      <FixedScreen refreshing={refreshing} onRefresh={() => void refresh({ manual: true })}>
        <View style={s.empty}>
          <Text style={s.emptyText}>Waiting for your Mac&apos;s first sync…</Text>
          <Text style={s.emptySub}>Pull to retry. budgetr must be running on your Mac.</Text>
        </View>
      </FixedScreen>
    );
  }

  return (
    <>
      <FixedScreen refreshing={refreshing} onRefresh={() => void refresh({ manual: true })}>
        {/* head — title, wallet chip, settings */}
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Eyebrow>{`${win.label} · day ${win.dayOfMonth} of ${win.daysInMonth}`}</Eyebrow>
            <Text style={s.title}>Spending</Text>
          </View>
          <PressableScale
            hitSlop={10}
            style={s.chip}
            onPress={() => {
              haptics.tap();
              setWalletOpen(true);
            }}
          >
            <Wallet size={15} color={T.muted} />
            {hasAlerts && <View style={s.dot} />}
          </PressableScale>
          <PressableScale
            hitSlop={10}
            style={s.chip}
            onPress={() => {
              haptics.tap();
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={15} color={T.muted} />
          </PressableScale>
        </View>

        {/* hero — month to date, and how it compares */}
        <Animated.View entering={entering(0)} style={s.hero}>
          <AnimatedMoney cents={totals.spentCents} style={s.heroValue} />
          <View style={s.heroMeta}>
            {totals.deltaPct !== null ? (
              <Text style={[s.delta, { color: up ? T.coral : T.jade }]}>
                {up ? "▲" : "▼"} {Math.abs(Math.round(totals.deltaPct))}%
              </Text>
            ) : null}
            <Text style={s.heroSub}>
              {totals.deltaPct !== null ? `vs ${moneyCompact(totals.priorCents)} by this day last month` : "this month"}
            </Text>
          </View>
        </Animated.View>

        {/* one chart slot, three readings */}
        <Animated.View entering={entering(1)}>
          <Card style={s.chartCard}>
            <View style={s.chartHead}>
              <Eyebrow>
                {mode === "daily" ? "By day" : mode === "pace" ? "Cumulative vs pace" : "Where it went"}
              </Eyebrow>
              <View style={s.segWrap}>
                <Segmented options={CHART_MODES} value={mode} onChange={setMode} />
              </View>
            </View>
            <View style={s.chartBody}>
              {mode === "daily" &&
                (monthDays.length > 0 ? (
                  <Bars points={monthDays} height={104} />
                ) : (
                  <Text style={s.chartEmpty}>No spending recorded this month.</Text>
                ))}
              {mode === "pace" &&
                (totals.cumulative.length > 1 ? (
                  <PaceLine
                    cumulative={totals.cumulative}
                    limitCents={totalLimit}
                    daysInMonth={win.daysInMonth}
                    dayOfMonth={win.dayOfMonth}
                    height={116}
                  />
                ) : (
                  <Text style={s.chartEmpty}>Not enough of the month yet to draw a pace.</Text>
                ))}
              {mode === "mix" &&
                (rows.length > 0 ? (
                  <View style={s.mix}>
                    <Donut
                      size={116}
                      slices={mixSlices(rows, totals.spentCents).map((sl, i) => ({
                        cents: sl.cents,
                        color: PIE_COLORS[i % PIE_COLORS.length],
                      }))}
                    />
                    <View style={s.legend}>
                      {mixSlices(rows, totals.spentCents).map((sl, i) => (
                        <View key={sl.id} style={s.legendRow}>
                          <View style={[s.swatch, { backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }]} />
                          <Text style={s.legendName} numberOfLines={1}>
                            {sl.name}
                          </Text>
                          <Text style={s.legendValue}>{moneyCompact(sl.cents)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text style={s.chartEmpty}>No categorized spending yet this month.</Text>
                ))}
            </View>
          </Card>
        </Animated.View>

        {/* categories — the part you tap into */}
        <View style={s.gridHead}>
          <Eyebrow>Categories</Eyebrow>
          {rows.length > TILES && (
            <Pressable
              hitSlop={8}
              onPress={() => {
                haptics.tap();
                setAllOpen(true);
              }}
            >
              <Text style={s.allLink}>All {rows.length} ›</Text>
            </Pressable>
          )}
        </View>
        <View style={s.grid}>
          {rows.slice(0, TILES).map((r, i) => (
            <CategoryTile key={r.id} row={r} index={i} onPress={() => setOpenCat(r)} />
          ))}
          {rows.length === 0 && <Text style={s.chartEmpty}>No spending categorized this month yet.</Text>}
        </View>
      </FixedScreen>

      <CategorySheet row={openCat} onClose={() => setOpenCat(null)} />
      <AllCategoriesSheet
        visible={allOpen}
        rows={rows}
        total={totals.spentCents}
        onClose={() => setAllOpen(false)}
        onPick={(r) => {
          setAllOpen(false);
          setOpenCat(r);
        }}
      />
      <WalletSheet visible={walletOpen} onClose={() => setWalletOpen(false)} />
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingBottom: 10 },
  title: { fontFamily: F.display, color: T.paper, fontSize: 30, letterSpacing: -0.3, marginTop: 4 },
  chip: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    backgroundColor: T.panel,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  dot: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: T.coral,
    borderWidth: 1.5,
    borderColor: T.panel,
  },
  hero: { paddingTop: 4, paddingBottom: 14 },
  heroValue: { color: T.paper, fontSize: 44, fontFamily: F.display, letterSpacing: -1 },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  delta: { fontFamily: F.monoSemiBold, fontSize: 12.5 },
  heroSub: { color: T.faint, fontSize: 12, fontFamily: F.sans, flex: 1 },

  chartCard: { paddingVertical: 16, marginBottom: 12 },
  chartHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  segWrap: { width: 168 },
  chartBody: { height: CHART_H, justifyContent: "center" },
  chartEmpty: { color: T.faint, fontSize: 12, fontFamily: F.sans, textAlign: "center" },
  mix: { flexDirection: "row", alignItems: "center", gap: 14 },
  legend: { flex: 1, gap: 4 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  legendName: { color: T.muted, fontSize: 11.5, fontFamily: F.sans, flex: 1 },
  legendValue: { color: T.paper, fontSize: 11.5, fontFamily: F.mono },

  gridHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  allLink: { color: T.brass, fontSize: 12, fontFamily: F.sansSemiBold },
  grid: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 10, alignContent: "flex-start" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { color: T.paper, fontSize: 16, fontFamily: F.sansSemiBold },
  emptySub: { color: T.muted, fontSize: 13, marginTop: 6, textAlign: "center", fontFamily: F.sans },
});

const ct = StyleSheet.create({
  wrap: { width: "48%", flexGrow: 1 },
  tile: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    backgroundColor: "rgba(19,26,24,0.72)",
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: T.muted, fontSize: 11.5, fontFamily: F.sansSemiBold, flex: 1 },
  amount: { color: T.paper, fontSize: 19, fontFamily: F.monoSemiBold, marginTop: 5 },
  track: { height: 3, borderRadius: 2, backgroundColor: T.ink, marginTop: 8, overflow: "hidden" },
  fill: { height: 3, borderRadius: 2 },
  sub: { color: T.faint, fontSize: 10, fontFamily: F.sans, marginTop: 5 },
  subLoose: { marginTop: 8 },
});

const cs = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 9 },
  title: { color: T.paper, fontSize: 21, fontFamily: F.display },
  hero: { color: T.paper, fontSize: 36, fontFamily: F.display, letterSpacing: -0.8, marginTop: 10 },
  heroSub: { color: T.faint, fontSize: 12, fontFamily: F.sans, marginTop: 3 },
  meterSub: { color: T.muted, fontSize: 12, fontFamily: F.sans, marginTop: 10 },
  chart: { marginTop: 18 },
  section: {
    color: T.brass,
    fontSize: 10,
    fontFamily: F.sansSemiBold,
    letterSpacing: 1.6,
    marginTop: 20,
    marginBottom: 4,
  },
  txn: { flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 12 },
  txnBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  merchant: { color: T.paper, fontSize: 14.5, fontFamily: F.sansMedium },
  txnMeta: { color: T.faint, fontSize: 11.5, fontFamily: F.sans, marginTop: 2, textTransform: "capitalize" },
  txnAmount: { color: T.paper, fontSize: 13.5, fontFamily: F.mono },
  empty: { color: T.faint, fontSize: 12.5, fontFamily: F.sans, paddingVertical: 14 },
  allRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11 },
  allTrack: { height: 3, borderRadius: 2, backgroundColor: T.ink, marginTop: 6, overflow: "hidden" },
  allFill: { height: 3, borderRadius: 2 },
  alert: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.lineStrong,
    backgroundColor: T.panel2,
    padding: 12,
    marginBottom: 8,
  },
  alertText: { color: T.paper, fontSize: 13, lineHeight: 18, fontFamily: F.sans },
  swipeZone: {
    width: 92,
    marginLeft: 8,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: "rgba(240,137,123,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.coral,
    alignItems: "center",
    justifyContent: "center",
  },
  swipeZoneText: { color: T.coral, fontFamily: F.sansSemiBold, fontSize: 12.5 },
});

const st = StyleSheet.create({
  title: { color: T.paper, fontSize: 21, fontFamily: F.display },
  sub: { color: T.brass, fontSize: 10.5, fontFamily: F.sansSemiBold, letterSpacing: 1.8, marginTop: 4, marginBottom: 10 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.line,
  },
  rowLabel: { color: T.muted, fontSize: 14, fontFamily: F.sans },
  rowValue: { color: T.paper, fontSize: 14, fontFamily: F.mono },
  privacy: { color: T.faint, fontSize: 12.5, lineHeight: 18, fontFamily: F.sans, marginTop: 14, marginBottom: 6 },
  action: {
    marginTop: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    backgroundColor: T.panel2,
    paddingVertical: 12,
    alignItems: "center",
  },
  danger: { backgroundColor: "transparent", borderColor: T.coral + "55" },
  actionText: { color: T.paper, fontSize: 14.5, fontFamily: F.sansSemiBold },
});

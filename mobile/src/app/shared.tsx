// Shared — what you're owed, and squaring up.
//
// The tab leads with one number because there is one question: does anyone owe
// me money. Everything below it is the audit trail for that number, and the
// settlement suggestions near the top are the reason this belongs on a phone at
// all — the desktop already spots that a Venmo inflow matches an outstanding
// share, and the moment you want to confirm that is the moment it lands, not
// next time you sit at a desk.
//
// The phone never computes a balance. The desktop nets owed against settled and
// ships the result; this screen renders it.

import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, LinearTransition, useReducedMotion } from "react-native-reanimated";
import type { PersonSummary, SharedExpenseSummary } from "@budgetr/core";
import { dayLabel, money } from "@/format";
import * as haptics from "@/haptics";
import { F, T } from "@/theme";
import { useRouter } from "expo-router";
import { useCompanion } from "@/state/companion";
import { Card, Eyebrow, SyncBanner } from "@/ui/bits";
import { Screen } from "@/ui/screen";
import { useEntering } from "@/ui/motion";
import { Sheet } from "@/ui/sheet";

/** Stable per-person colour, matching the desktop's when it sends one. */
const FALLBACK_COLORS = [T.brass, T.jade, "#7fb2e0", "#c98bd0", "#e0a26b", "#7fd0c4"];

export function personColor(p: PersonSummary, index: number): string {
  return p.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]!;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export default function Shared() {
  const { summary, refresh, refreshing, recordSettlement } = useCompanion();
  const entering = useEntering();
  const reduced = useReducedMotion();
  const router = useRouter();
  const [openPerson, setOpenPerson] = useState<PersonSummary | null>(null);

  const people = useMemo(() => summary?.people ?? [], [summary]);
  const shared = useMemo(() => summary?.shared ?? [], [summary]);
  const suggestions = useMemo(() => summary?.settleSuggestions ?? [], [summary]);

  // Net across everyone. Signed: positive means the balance is in your favour.
  const net = people.reduce((a, p) => a + p.cents, 0);
  const owing = people.filter((p) => p.cents > 0);
  const owed = people.filter((p) => p.cents < 0);

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "someone";

  return (
    <>
      <Screen title="Shared" refreshing={refreshing} onRefresh={() => void refresh({ manual: true })}>
        <SyncBanner />

        {people.length === 0 ? (
          <Text style={s.emptyText}>
            Nobody to split with yet. Add people on your Mac, then split a bill from the Activity
            tab.
          </Text>
        ) : (
          <>
            <Animated.View entering={entering(0)}>
              <Card>
                <Eyebrow color={net >= 0 ? T.jade : T.coral}>
                  {net >= 0 ? "Owed to you" : "You owe"}
                </Eyebrow>
                <Text style={[s.hero, { color: net >= 0 ? T.jade : T.coral }]}>
                  {money(Math.abs(net))}
                </Text>
                <Text style={s.heroSub}>
                  {owing.length > 0 &&
                    `${owing.length} ${owing.length === 1 ? "person owes" : "people owe"} you`}
                  {owing.length > 0 && owed.length > 0 && " · "}
                  {owed.length > 0 && `you owe ${owed.length}`}
                  {owing.length === 0 && owed.length === 0 && "all square"}
                </Text>
              </Card>
            </Animated.View>

            {/* The reason this tab is on a phone. */}
            {suggestions.map((sg) => (
              <Animated.View key={sg.txnId} entering={FadeIn.duration(200)}>
                <View style={s.suggest}>
                  <View style={s.suggestDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.suggestTitle}>
                      {nameOf(sg.personId)} sent you {money(sg.cents)}
                    </Text>
                    <Text style={s.suggestDetail} numberOfLines={2}>
                      {sg.detail}
                    </Text>
                  </View>
                </View>
                <View style={s.suggestActions}>
                  <Pressable
                    onPress={() => {
                      haptics.success();
                      recordSettlement({
                        personId: sg.personId,
                        cents: sg.cents,
                        txnId: sg.txnId,
                      });
                    }}
                    style={[s.action, s.actionPrimary]}
                  >
                    <Text style={s.actionPrimaryText}>Settle up</Text>
                  </Pressable>
                  <Text style={s.actionNote}>Recorded on your Mac</Text>
                </View>
              </Animated.View>
            ))}

            <Animated.View entering={entering(1)}>
              <Card>
                <Eyebrow>People</Eyebrow>
                <View style={{ marginTop: 4 }}>
                  {people.map((p, i) => (
                    <Animated.View
                      key={p.id}
                      layout={reduced ? undefined : LinearTransition.springify().stiffness(320).damping(42)}
                    >
                      <Pressable
                        onPress={() => {
                          haptics.tick();
                          setOpenPerson(p);
                        }}
                        style={[s.personRow, i > 0 && s.rowBorder]}
                      >
                        <View style={[s.avatar, { backgroundColor: personColor(p, i) }]}>
                          <Text style={s.avatarText}>{initialsOf(p.name)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.personName} numberOfLines={1}>
                            {p.name}
                          </Text>
                          <Text style={s.personMeta}>
                            {p.openCount} {p.openCount === 1 ? "bill" : "bills"}
                            {p.lastSettledAt ? ` · settled ${dayLabel(p.lastSettledAt)}` : ""}
                          </Text>
                        </View>
                        <Text
                          style={[
                            s.personAmount,
                            { color: p.cents > 0 ? T.jade : p.cents < 0 ? T.coral : T.faint },
                          ]}
                        >
                          {p.cents === 0 ? "square" : money(Math.abs(p.cents))}
                        </Text>
                      </Pressable>
                    </Animated.View>
                  ))}
                </View>
              </Card>
            </Animated.View>

            <Animated.View entering={entering(2)}>
              <Card>
                <Eyebrow>Recent bills</Eyebrow>
                {shared.length === 0 ? (
                  <Text style={s.billEmpty}>Nothing split yet.</Text>
                ) : (
                  <View style={{ marginTop: 4 }}>
                    {shared.slice(0, 12).map((e, i) => (
                      <BillRow key={e.id} bill={e} first={i === 0} />
                    ))}
                  </View>
                )}
              </Card>
            </Animated.View>
            {/* Splitting happens on the transaction, so this points at it rather
                than duplicating a picker here. */}
            <Pressable
              onPress={() => {
                haptics.tap();
                router.push("/activity");
              }}
              style={s.splitCta}
            >
              <Text style={s.splitCtaText}>＋ Split a bill</Text>
              <Text style={s.splitCtaHint}>Pick it from Activity</Text>
            </Pressable>
          </>
        )}
      </Screen>

      <PersonSheet
        person={openPerson}
        bills={shared}
        onClose={() => setOpenPerson(null)}
        onSettle={(cents) => {
          if (!openPerson) return;
          haptics.success();
          recordSettlement({ personId: openPerson.id, cents });
          setOpenPerson(null);
        }}
      />

    </>
  );
}

function BillRow({ bill, first }: { bill: SharedExpenseSummary; first: boolean }) {
  return (
    <View style={[s.billRow, !first && s.rowBorder]}>
      <View style={{ flex: 1 }}>
        <Text style={s.billName} numberOfLines={1}>
          {bill.merchant}
          {bill.itemized ? <Text style={s.byItem}>  by item</Text> : null}
        </Text>
        <Text style={s.billMeta}>
          {dayLabel(bill.ts)} · you {money(bill.myCents)} · {bill.shares.length}{" "}
          {bill.shares.length === 1 ? "other" : "others"}
        </Text>
      </View>
      <Text style={s.billAmount}>{money(bill.cents)}</Text>
    </View>
  );
}

/** One person: their balance, the bills behind it, and a way to square up. */
function PersonSheet({
  person,
  bills,
  onClose,
  onSettle,
}: {
  person: PersonSummary | null;
  bills: SharedExpenseSummary[];
  onClose: () => void;
  onSettle: (cents: number) => void;
}) {
  const theirs = useMemo(
    () => (person ? bills.filter((b) => b.shares.some((sh) => sh.personId === person.id)) : []),
    [bills, person],
  );

  return (
    <Sheet visible={person !== null} onClose={onClose}>
      {person === null ? null : (
        <>
          <Text style={sh.title}>{person.name}</Text>
          <Text style={[sh.hero, { color: person.cents >= 0 ? T.jade : T.coral }]}>
            {money(Math.abs(person.cents))}
          </Text>
          <Text style={sh.heroSub}>
            {person.cents > 0 ? "owes you" : person.cents < 0 ? "you owe them" : "all square"}
          </Text>

          <Text style={sh.section}>
            {theirs.length} SHARED BILL{theirs.length === 1 ? "" : "S"}
          </Text>
          <ScrollView style={{ maxHeight: 240 }}>
            {theirs.map((b) => {
              const share = b.shares.find((x) => x.personId === person.id);
              return (
                <View key={b.id} style={sh.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={sh.rowName} numberOfLines={1}>
                      {b.merchant}
                    </Text>
                    <Text style={sh.rowMeta}>
                      {dayLabel(b.ts)} · bill {money(b.cents)}
                    </Text>
                  </View>
                  <Text style={sh.rowAmount}>{money(share?.cents ?? 0)}</Text>
                </View>
              );
            })}
            {theirs.length === 0 && <Text style={sh.empty}>Nothing on the recent tape.</Text>}
          </ScrollView>

          {person.cents > 0 && (
            <Pressable style={sh.settle} onPress={() => onSettle(person.cents)}>
              <Text style={sh.settleText}>Mark {money(person.cents)} as paid back</Text>
            </Pressable>
          )}
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  emptyText: {
    color: T.muted,
    textAlign: "center",
    marginTop: 60,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: F.sans,
    paddingHorizontal: 24,
  },
  hero: { fontFamily: F.display, fontSize: 40, letterSpacing: -0.8, marginTop: 6 },
  heroSub: { color: T.muted, fontSize: 12.5, fontFamily: F.sans, marginTop: 4 },

  suggest: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.jade,
    backgroundColor: "rgba(111,227,166,0.10)",
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  suggestDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.jade, marginTop: 5 },
  suggestTitle: { color: T.paper, fontSize: 14, fontFamily: F.sansMedium },
  suggestDetail: { color: T.muted, fontSize: 11.5, fontFamily: F.sans, marginTop: 2, lineHeight: 16 },
  suggestActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 0,
    borderColor: T.jade,
    backgroundColor: "rgba(111,227,166,0.10)",
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  action: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  actionPrimary: { backgroundColor: T.jade },
  actionPrimaryText: { color: T.ink, fontSize: 12, fontFamily: F.sansMedium },
  actionNote: { color: T.faint, fontSize: 10.5, fontFamily: F.mono },

  personRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { color: T.ink, fontSize: 11, fontFamily: F.monoSemiBold },
  personName: { color: T.paper, fontSize: 14.5, fontFamily: F.sansMedium },
  personMeta: { color: T.muted, fontSize: 11, fontFamily: F.sans, marginTop: 1 },
  personAmount: { fontSize: 15, fontFamily: F.monoSemiBold },

  billRow: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10 },
  billName: { color: T.paper, fontSize: 13.5, fontFamily: F.sans },
  byItem: { color: T.brass, fontSize: 10, fontFamily: F.mono },
  billMeta: { color: T.muted, fontSize: 10.5, fontFamily: F.mono, marginTop: 1 },
  billAmount: { color: T.paper, fontSize: 13, fontFamily: F.monoSemiBold },
  billEmpty: { color: T.muted, fontSize: 12.5, fontFamily: F.sans, marginTop: 10 },
  splitCta: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.brassDim,
    backgroundColor: "rgba(203,176,124,0.10)",
    paddingVertical: 13,
    alignItems: "center",
  },
  splitCtaText: { color: T.brass, fontSize: 14, fontFamily: F.sansMedium },
  splitCtaHint: { color: T.faint, fontSize: 10.5, fontFamily: F.mono, marginTop: 2 },
});

const sh = StyleSheet.create({
  title: { color: T.paper, fontSize: 20, fontFamily: F.display },
  hero: { fontSize: 34, fontFamily: F.display, letterSpacing: -0.6, marginTop: 6 },
  heroSub: { color: T.muted, fontSize: 12, fontFamily: F.sans, marginTop: 2 },
  section: {
    color: T.faint,
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: F.mono,
    marginTop: 20,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.line,
  },
  rowName: { color: T.paper, fontSize: 13.5, fontFamily: F.sans },
  rowMeta: { color: T.muted, fontSize: 10.5, fontFamily: F.mono, marginTop: 1 },
  rowAmount: { color: T.jade, fontSize: 13, fontFamily: F.monoSemiBold },
  empty: { color: T.muted, fontSize: 12.5, fontFamily: F.sans, paddingVertical: 12 },
  settle: {
    marginTop: 18,
    borderRadius: 999,
    backgroundColor: T.jade,
    paddingVertical: 12,
    alignItems: "center",
  },
  settleText: { color: T.ink, fontSize: 13.5, fontFamily: F.sansMedium },
});

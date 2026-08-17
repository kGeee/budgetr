// Split a bill, on the phone.
//
// The interaction is the desktop's, which was designed for touch and only
// happens to have shipped on a Mac first: pick whose turn it is once, then tap
// down the receipt. A shared plate is everyone at weight 1, so there is no
// shared-vs-individual switch to explain.
//
// The arithmetic is not reimplemented here. `allocateReceipt` and the parser
// live in @budgetr/core precisely so both clients round through one
// implementation — two devices showing the same bill a cent apart is the kind of
// bug nobody reports and everybody quietly stops trusting.

import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  ME,
  allocateReceipt,
  assignAllEvenly,
  chargeGap,
  itemsTotal,
  receiptTotal,
  type ItemAssignment,
  type ParsedReceipt,
} from "@budgetr/core";
import { money } from "@/format";
import * as haptics from "@/haptics";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Sheet } from "@/ui/sheet";
import { initialsOf, personColor } from "@/app/shared";

const emptyReceipt = (): ParsedReceipt => ({
  items: [],
  subtotal: null,
  tax: null,
  tip: null,
  total: null,
  taxRatePct: null,
  discrepancy: null,
  unparsed: [],
});

export function SplitSheet({ txnId, onClose }: { txnId: string | null; onClose: () => void }) {
  const { summary, splitBill } = useCompanion();
  const [receipt, setReceipt] = useState<ParsedReceipt>(emptyReceipt);
  const [assignments, setAssignments] = useState<Record<string, ItemAssignment>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [brush, setBrush] = useState<string>(ME);

  const txn = useMemo(
    () => (txnId ? (summary?.recent ?? []).find((t) => t.id === txnId) ?? null : null),
    [summary, txnId],
  );
  const people = useMemo(() => summary?.people ?? [], [summary]);

  // You, plus whoever is in this split. `ME` is the same sentinel the desktop
  // uses, so a round-tripped itemsJson means the same thing on both.
  const participants = useMemo(
    () => [
      { id: ME, name: "You", color: T.brass },
      ...selected.map((id, i) => {
        const p = people.find((x) => x.id === id);
        return { id, name: p?.name ?? "—", color: p ? personColor(p, i + 1) : T.muted };
      }),
    ],
    [selected, people],
  );

  const charged = Math.abs((txn?.cents ?? 0) / 100);
  const split = useMemo(
    () =>
      allocateReceipt({
        receipt,
        assignments,
        participantIds: participants.map((p) => p.id),
      }),
    [receipt, assignments, participants],
  );

  const gap = chargeGap(receipt, charged);
  const total = receiptTotal(receipt);
  const unassigned = split.unassignedItemIds.length;
  const blocked =
    selected.length === 0 || receipt.items.length === 0 || unassigned > 0 || Math.abs(gap) >= 0.01;

  function setWeight(itemId: string, personId: string, weight: number) {
    const next = { ...(assignments[itemId] ?? {}) };
    if (weight <= 0) delete next[personId];
    else next[personId] = weight;
    setAssignments({ ...assignments, [itemId]: next });
  }

  function addLine() {
    const id = `it${receipt.items.length + 1}`;
    setReceipt({
      ...receipt,
      items: [...receipt.items, { id, label: "", quantity: 1, unitPrice: null, total: 0, modifiers: [] }],
    });
    setAssignments({ ...assignments, [id]: { [brush]: 1 } });
  }

  function save() {
    if (!txn || blocked) return;
    haptics.success();
    splitBill({
      txnId: txn.id,
      // Everyone but you — your own share is the remainder, which the desktop
      // derives so the two halves can never disagree about it.
      shares: split.people
        .filter((p) => p.participantId !== ME && p.total > 0.004)
        .map((p) => ({ personId: p.participantId, cents: Math.round(p.total * 100) })),
      basisCents: Math.round(total * 100),
      itemsJson: JSON.stringify({ v: 1, receipt, assignments }),
    });
    reset();
    onClose();
  }

  function reset() {
    setReceipt(emptyReceipt());
    setAssignments({});
    setSelected([]);
    setBrush(ME);
  }

  return (
    <Sheet
      visible={txnId !== null}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      {txn === null ? null : (
        <>
          <Text style={s.title}>{txn.merchant}</Text>
          <Text style={s.sub}>{money(Math.abs(txn.cents))} charged</Text>

          {/* Who's in */}
          <Text style={s.section}>SPLIT WITH</Text>
          <View style={s.chips}>
            {people.map((p, i) => {
              const on = selected.includes(p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    haptics.tick();
                    setSelected((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]));
                  }}
                  style={[s.chip, on && { borderColor: personColor(p, i + 1) }]}
                >
                  <Text style={[s.chipText, on && { color: T.paper }]}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>

          {selected.length > 0 && (
            <>
              {/* Whose turn it is */}
              <Text style={s.section}>TAP LINES TO ASSIGN</Text>
              <View style={s.chips}>
                {participants.map((p) => {
                  const on = p.id === brush;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        haptics.tick();
                        setBrush(p.id);
                      }}
                      style={[s.chip, on && { borderColor: p.color, backgroundColor: `${p.color}22` }]}
                    >
                      <View style={[s.avatar, { backgroundColor: p.color }]}>
                        <Text style={s.avatarText}>{initialsOf(p.name)}</Text>
                      </View>
                      <Text style={[s.chipText, on && { color: T.paper }]}>{p.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <ScrollView style={{ maxHeight: 220 }}>
                {receipt.items.map((item) => {
                  const weights = assignments[item.id] ?? {};
                  const on = participants.filter((p) => (weights[p.id] ?? 0) > 0);
                  const mine = (weights[brush] ?? 0) > 0;
                  return (
                    <View key={item.id} style={[s.line, on.length === 0 && s.lineOrphan]}>
                      <Pressable
                        onPress={() => {
                          haptics.tick();
                          setWeight(item.id, brush, mine ? 0 : 1);
                        }}
                        style={s.check}
                      >
                        <View style={[s.checkBox, mine && { backgroundColor: T.brass, borderColor: T.brass }]} />
                      </Pressable>
                      <TextInput
                        value={item.label}
                        placeholder="Item"
                        placeholderTextColor={T.faint}
                        onChangeText={(v) =>
                          setReceipt({
                            ...receipt,
                            items: receipt.items.map((it) => (it.id === item.id ? { ...it, label: v } : it)),
                          })
                        }
                        style={s.lineName}
                      />
                      <View style={s.avatars}>
                        {on.map((p) => (
                          <View key={p.id} style={[s.avatarSm, { backgroundColor: p.color }]}>
                            <Text style={s.avatarSmText}>{initialsOf(p.name)}</Text>
                          </View>
                        ))}
                      </View>
                      <TextInput
                        value={item.total === 0 ? "" : String(item.total)}
                        placeholder="0.00"
                        placeholderTextColor={T.faint}
                        keyboardType="decimal-pad"
                        onChangeText={(v) =>
                          setReceipt({
                            ...receipt,
                            items: receipt.items.map((it) =>
                              it.id === item.id ? { ...it, total: Number(v) || 0 } : it,
                            ),
                          })
                        }
                        style={s.linePrice}
                      />
                    </View>
                  );
                })}
              </ScrollView>

              <View style={s.lineActions}>
                <Pressable onPress={addLine}>
                  <Text style={s.addLineText}>＋ Add a line</Text>
                </Pressable>
                {receipt.items.length > 0 && (
                  <Pressable
                    onPress={() => {
                      haptics.tick();
                      setAssignments(assignAllEvenly(receipt, participants.map((p) => p.id)));
                    }}
                  >
                    <Text style={s.bulkText}>Everyone on everything</Text>
                  </Pressable>
                )}
              </View>

              {/* Tax and tip. Never assignable — they follow the food. */}
              <View style={s.totals}>
                <TotalRow label="Items" value={money(itemsTotal(receipt) * 100)} />
                <MoneyRow
                  label="Tax"
                  value={receipt.tax}
                  onChange={(v) => setReceipt({ ...receipt, tax: v })}
                />
                <MoneyRow
                  label="Tip"
                  value={receipt.tip}
                  onChange={(v) => setReceipt({ ...receipt, tip: v })}
                />
                <TotalRow label="Receipt total" value={money(total * 100)} strong />
              </View>

              {Math.abs(gap) >= 0.01 && (
                <Pressable
                  onPress={() =>
                    setReceipt({ ...receipt, tip: Math.round(((receipt.tip ?? 0) + gap) * 100) / 100 })
                  }
                  style={s.gap}
                >
                  <Text style={s.gapText}>
                    {gap > 0
                      ? `${money(gap * 100)} of the charge isn't on the receipt — tap to add as tip`
                      : `${money(Math.abs(gap) * 100)} more than was charged — a tip still settling`}
                  </Text>
                </Pressable>
              )}

              {unassigned > 0 && (
                <Text style={s.warn}>
                  {unassigned} {unassigned === 1 ? "line needs" : "lines need"} someone
                </Text>
              )}

              <View style={s.owes}>
                {split.people.map((p) => {
                  const meta = participants.find((x) => x.id === p.participantId);
                  return (
                    <View key={p.participantId} style={s.owesRow}>
                      <Text style={s.owesName}>{meta?.name ?? "—"}</Text>
                      <Text style={s.owesAmount}>{money(p.total * 100)}</Text>
                    </View>
                  );
                })}
              </View>

              <Pressable onPress={save} disabled={blocked} style={[s.save, blocked && s.saveOff]}>
                <Text style={s.saveText}>Save split</Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.totalRow}>
      <Text style={[s.totalLabel, strong && { color: T.paper }]}>{label}</Text>
      <Text style={[s.totalValue, strong && { color: T.paper }]}>{value}</Text>
    </View>
  );
}

function MoneyRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  // The draft is held as text so a trailing decimal point survives — storing
  // Number(text) and rendering String(value) is what makes a field silently
  // refuse cents.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <View style={s.totalRow}>
      <Text style={s.totalLabel}>{label}</Text>
      <TextInput
        value={draft ?? (value == null ? "" : String(value))}
        placeholder="0.00"
        placeholderTextColor={T.faint}
        keyboardType="decimal-pad"
        onChangeText={(v) => {
          if (!/^\d{0,9}(\.\d{0,2})?$/.test(v) && v !== "" && v !== ".") return;
          setDraft(v);
          const n = Number(v);
          onChange(v === "" || v === "." || !Number.isFinite(n) ? null : n);
        }}
        onBlur={() => setDraft(null)}
        style={s.totalInput}
      />
    </View>
  );
}

const s = StyleSheet.create({
  title: { color: T.paper, fontSize: 20, fontFamily: F.display },
  sub: { color: T.muted, fontSize: 12, fontFamily: F.mono, marginTop: 2 },
  section: { color: T.faint, fontSize: 10, letterSpacing: 1, fontFamily: F.mono, marginTop: 18, marginBottom: 7 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { color: T.muted, fontSize: 12, fontFamily: F.sans },
  avatar: { width: 17, height: 17, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarText: { color: T.ink, fontSize: 8, fontFamily: F.monoSemiBold },

  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.line,
  },
  lineOrphan: { borderTopColor: T.coral },
  check: { padding: 3 },
  checkBox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: T.lineStrong },
  lineName: { flex: 1, color: T.paper, fontSize: 13.5, fontFamily: F.sans, paddingVertical: 2 },
  avatars: { flexDirection: "row", gap: 2 },
  avatarSm: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  avatarSmText: { color: T.ink, fontSize: 7.5, fontFamily: F.monoSemiBold },
  linePrice: {
    width: 66,
    color: T.paper,
    fontSize: 13,
    fontFamily: F.mono,
    textAlign: "right",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  lineActions: { flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 10 },
  addLineText: { color: T.brass, fontSize: 12.5, fontFamily: F.sans },
  bulkText: { color: T.muted, fontSize: 12.5, fontFamily: F.sans },

  totals: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line, marginTop: 4 },
  totalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7 },
  totalLabel: { color: T.muted, fontSize: 12.5, fontFamily: F.sans },
  totalValue: { color: T.muted, fontSize: 13, fontFamily: F.mono },
  totalInput: {
    width: 82,
    color: T.paper,
    fontSize: 13,
    fontFamily: F.mono,
    textAlign: "right",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.line,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },

  gap: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: T.brassDim,
    backgroundColor: "rgba(203,176,124,0.12)",
    paddingHorizontal: 11,
    paddingVertical: 8,
    marginTop: 8,
  },
  gapText: { color: T.brass, fontSize: 11.5, fontFamily: F.sans, lineHeight: 16 },
  warn: { color: T.coral, fontSize: 11.5, fontFamily: F.sans, marginTop: 8 },

  owes: { marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: T.line },
  owesRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  owesName: { color: T.paper, fontSize: 13, fontFamily: F.sans },
  owesAmount: { color: T.paper, fontSize: 13, fontFamily: F.monoSemiBold },

  save: { marginTop: 16, borderRadius: 999, backgroundColor: T.brass, paddingVertical: 12, alignItems: "center" },
  saveOff: { opacity: 0.4 },
  saveText: { color: T.ink, fontSize: 13.5, fontFamily: F.sansMedium },
});

"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Pin, Plus, Receipt, Trash2, TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import {
  addTaxLotOverride,
  removeTaxLotOverride,
  setCostBasisMethod,
} from "@/lib/actions";
import type { InvestmentTxnRow, TaxLotOverrideRow } from "@/lib/queries";
import { tradeAction, type RealizedLot } from "@/lib/tax-lots";

const METHODS: { value: string; label: string }[] = [
  { value: "FIFO", label: "FIFO" },
  { value: "LIFO", label: "LIFO" },
  { value: "specid", label: "Spec-ID" },
];

type Totals = {
  shortTerm: number;
  longTerm: number;
  total: number;
  proceeds: number;
  basis: number;
  disallowedWash: number;
  count: number;
};

function totalsFor(lots: RealizedLot[]): Totals {
  let shortTerm = 0;
  let longTerm = 0;
  let proceeds = 0;
  let basis = 0;
  let disallowedWash = 0;
  for (const l of lots) {
    if (l.section1256) {
      longTerm += l.gain * 0.6;
      shortTerm += l.gain * 0.4;
    } else if (l.term === "long") longTerm += l.gain;
    else shortTerm += l.gain;
    proceeds += l.proceeds;
    basis += l.basis;
    if (l.washSale && l.gain < 0) disallowedWash += -l.gain;
  }
  return {
    shortTerm,
    longTerm,
    total: shortTerm + longTerm,
    proceeds,
    basis,
    disallowedWash,
    count: lots.length,
  };
}

function gainClass(v: number): string {
  return v > 0 ? "text-[var(--jade)]" : v < 0 ? "text-[var(--coral)]" : "text-[var(--muted)]";
}

function txnLabel(t: InvestmentTxnRow): string {
  const qty = t.quantity != null ? Math.abs(t.quantity) : 0;
  const px = t.price != null ? ` @ ${formatCurrency(t.price)}` : "";
  return `${t.date} · ${t.ticker ?? "?"} · ${qty}${px}`;
}

export function RealizedGainsView({
  lots,
  years,
  transactions,
  methods,
  overrides,
}: {
  lots: RealizedLot[];
  years: number[];
  transactions: InvestmentTxnRow[];
  methods: Record<string, string>;
  overrides: TaxLotOverrideRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [year, setYear] = useState<number | null>(years[0] ?? null);
  const globalMethod = methods["*"] ?? "FIFO";

  const shown = useMemo(
    () => (year != null ? lots.filter((l) => Number(l.closeDate.slice(0, 4)) === year) : lots),
    [lots, year],
  );
  const totals = useMemo(() => totalsFor(shown), [shown]);

  // Spec-ID applies to owned lots: a sale-to-close matched to a buy-to-open.
  const sells = useMemo(
    () => transactions.filter((t) => t.ticker && tradeAction(t) === "close-long"),
    [transactions],
  );
  const buys = useMemo(
    () => transactions.filter((t) => t.ticker && tradeAction(t) === "open-long"),
    [transactions],
  );
  const txnById = useMemo(() => {
    const m = new Map<string, InvestmentTxnRow>();
    for (const t of transactions) m.set(t.id, t);
    return m;
  }, [transactions]);

  const [sellTxnId, setSellTxnId] = useState("");
  const [buyTxnId, setBuyTxnId] = useState("");
  const [qty, setQty] = useState("");

  const csvHref = `/api/tax/realized-gains${year != null ? `?year=${year}` : ""}`;

  function chooseMethod(method: string) {
    if (method === globalMethod) return;
    start(async () => {
      await setCostBasisMethod("*", method);
      router.refresh();
    });
  }

  function addOverride() {
    const q = Number(qty);
    if (!sellTxnId || !buyTxnId || !Number.isFinite(q) || q <= 0) return;
    start(async () => {
      await addTaxLotOverride(sellTxnId, buyTxnId, q);
      setSellTxnId("");
      setBuyTxnId("");
      setQty("");
      router.refresh();
    });
  }

  function dropOverride(id: string) {
    start(async () => {
      await removeTaxLotOverride(id);
      router.refresh();
    });
  }

  const empty = lots.length === 0;

  return (
    <div className={`space-y-7 ${pending ? "opacity-70" : ""}`}>
      {/* Controls: year filter · method toggle · CSV export */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setYear(null)}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              year == null
                ? "bg-[var(--panel-2)] text-[var(--paper)] shadow-[var(--elev-1)]"
                : "text-[var(--muted)] hover:text-[var(--paper)]"
            }`}
          >
            All years
          </button>
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`mono rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                year === y
                  ? "bg-[var(--panel-2)] text-[var(--paper)] shadow-[var(--elev-1)]"
                  : "text-[var(--muted)] hover:text-[var(--paper)]"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border border-line bg-[var(--panel)] p-1">
            {METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => chooseMethod(m.value)}
                aria-pressed={globalMethod === m.value}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  globalMethod === m.value
                    ? "bg-[var(--brass)] text-[var(--on-brass)]"
                    : "text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <a
            href={csvHref}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--brass-dim)] px-4 py-2 text-sm font-medium text-[var(--brass)] transition-colors hover:bg-[color-mix(in_srgb,var(--brass)_12%,transparent)]"
          >
            <Download size={15} />
            Download CSV
          </a>
        </div>
      </div>

      {empty ? (
        <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Receipt size={28} className="text-[var(--muted)]" />
          <p className="text-[var(--paper)]">No realized gains yet</p>
          <p className="max-w-sm text-sm text-[var(--muted)]">
            Sell transactions in your investment ledger are matched against buy
            lots to compute capital gains. Once you have a completed sale it will
            show up here.
          </p>
        </Card>
      ) : (
        <>
          {/* Capital-gains summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryCard label="Short-term" value={totals.shortTerm} accent />
            <SummaryCard label="Long-term" value={totals.longTerm} accent />
            <SummaryCard label="Total realized" value={totals.total} accent />
            <Card className="p-5">
              <p className="eyebrow flex items-center gap-1.5">
                <TrendingDown size={13} /> Wash-sale disallowed
              </p>
              <p className="tabular mono mt-2 text-2xl font-semibold text-[var(--coral)]">
                {formatCurrency(totals.disallowedWash)}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {totals.count} lot{totals.count === 1 ? "" : "s"} · proceeds{" "}
                {formatCurrency(totals.proceeds)}
              </p>
            </Card>
          </div>

          {/* Lot detail table */}
          <div className="overflow-x-auto rounded-[var(--radius)] border border-line bg-[var(--panel)]">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-[var(--muted)]">
                  <th className="px-4 py-3 font-medium">Ticker</th>
                  <th className="px-4 py-3 font-medium">Opened</th>
                  <th className="px-4 py-3 font-medium">Closed</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 text-right font-medium">Proceeds</th>
                  <th className="px-4 py-3 text-right font-medium">Basis</th>
                  <th className="px-4 py-3 text-right font-medium">Gain / loss</th>
                  <th className="px-4 py-3 font-medium">Term</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l, i) => (
                  <tr
                    key={`${l.sellTxnId}:${l.buyTxnId}:${i}`}
                    className="border-b border-line/50 last:border-0"
                  >
                    <td className="px-4 py-3 font-medium">
                      <span>{l.ticker}</span>
                      {l.position === "short" && (
                        <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--muted)]">
                          written
                        </span>
                      )}
                    </td>
                    <td className="mono px-4 py-3 text-xs text-[var(--muted)]">{l.openDate}</td>
                    <td className="mono px-4 py-3 text-xs text-[var(--muted)]">{l.closeDate}</td>
                    <td className="tabular mono px-4 py-3 text-right text-[var(--muted)]">
                      {l.quantity}
                    </td>
                    <td className="tabular mono px-4 py-3 text-right">{formatCurrency(l.proceeds)}</td>
                    <td className="tabular mono px-4 py-3 text-right">{formatCurrency(l.basis)}</td>
                    <td className={`tabular mono px-4 py-3 text-right ${gainClass(l.gain)}`}>
                      {formatCurrency(l.gain)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] ${
                            l.section1256
                              ? "border-[var(--brass-dim)] text-[var(--brass)]"
                              : l.term === "long"
                              ? "border-[var(--jade)]/40 text-[var(--jade)]"
                              : "border-line text-[var(--muted)]"
                          }`}
                        >
                          {l.section1256 ? "1256 · 60/40" : l.term === "long" ? "Long" : "Short"}
                        </span>
                        {l.washSale && (
                          <span
                            title="Wash sale — loss disallowed"
                            className="rounded-full border border-[var(--coral)]/40 px-2 py-0.5 text-[11px] text-[var(--coral)]"
                          >
                            Wash
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                      No realized lots in {year}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {shown.some((l) => l.section1256) && (
            <p className="rounded-xl border border-[var(--brass-dim)]/60 bg-[color-mix(in_srgb,var(--brass)_7%,transparent)] px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
              SPX/SPXW broad-based index options are shown with Section 1256 character: 60% long-term
              and 40% short-term, regardless of holding period. The worksheet reconstructs closed
              ledger activity; confirm year-end mark-to-market amounts against Form 1099-B and Form 6781.
            </p>
          )}

          {/* Spec-ID override controls — only relevant under spec-ID matching */}
          {globalMethod === "specid" && (
            <Card className="space-y-4">
              <div>
                <p className="eyebrow flex items-center gap-1.5">
                  <Pin size={13} /> Spec-ID lot assignments
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Pin units of a long-position sale to a specific purchase lot. Unpinned units
                  fall back to FIFO.
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Sell
                  <select
                    value={sellTxnId}
                    onChange={(e) => setSellTxnId(e.target.value)}
                    className="min-w-52 rounded-lg border border-line bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--paper)]"
                  >
                    <option value="">Select a sale…</option>
                    {sells.map((t) => (
                      <option key={t.id} value={t.id}>
                        {txnLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Buy lot
                  <select
                    value={buyTxnId}
                    onChange={(e) => setBuyTxnId(e.target.value)}
                    className="min-w-52 rounded-lg border border-line bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--paper)]"
                  >
                    <option value="">Select a purchase…</option>
                    {buys.map((t) => (
                      <option key={t.id} value={t.id}>
                        {txnLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Units
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                    className="w-24 rounded-lg border border-line bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--paper)]"
                  />
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addOverride}
                  disabled={!sellTxnId || !buyTxnId || !qty}
                >
                  <Plus size={14} /> Pin lot
                </Button>
              </div>

              {overrides.length > 0 && (
                <ul className="divide-y divide-line/60 border-t border-line/60">
                  {overrides.map((o) => {
                    const sell = txnById.get(o.sellTxnId);
                    const buy = txnById.get(o.buyTxnId);
                    return (
                      <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                        <span className="mono min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
                          {o.quantity} units · {sell ? txnLabel(sell) : o.sellTxnId}{" "}
                          <span className="text-[var(--faint)]">←</span>{" "}
                          {buy ? txnLabel(buy) : o.buyTxnId}
                        </span>
                        <button
                          onClick={() => dropOverride(o.id)}
                          aria-label="Remove pin"
                          className="shrink-0 rounded-md p-1.5 text-[var(--faint)] transition hover:text-[var(--coral)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Card className="p-5">
      <p className="eyebrow">{label}</p>
      <p
        className={`tabular mono mt-2 text-2xl font-semibold ${
          accent ? gainClass(value) : "text-[var(--paper)]"
        }`}
      >
        {formatCurrency(value)}
      </p>
    </Card>
  );
}

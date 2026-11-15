"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Pin, Plus, Receipt, Trash2 } from "lucide-react";
import { Hero, Mark, SectionHead } from "@/components/ui/statement";
import { pill, ruled, Segmented } from "@/components/portfolio/ruled";
import { realizedSplitVerdict, splitBarShares } from "@/lib/realized-split";
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

function gainTone(v: number): "jade" | "coral" | "muted" {
  return v > 0 ? "jade" : v < 0 ? "coral" : "muted";
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
  const split = realizedSplitVerdict({
    longTerm: totals.longTerm,
    shortTerm: totals.shortTerm,
    washLots: shown
      .filter((l) => l.washSale && l.gain < 0)
      .map((l) => ({ ticker: l.ticker, loss: -l.gain })),
  });
  const bar = splitBarShares(totals.longTerm, totals.shortTerm);
  const methodLabel = METHODS.find((m) => m.value === globalMethod)?.label ?? globalMethod;
  const yearOptions = [
    { value: "all", label: "All years" },
    ...years.map((y) => ({ value: String(y), label: String(y) })),
  ];

  return (
    <div className={`space-y-9 ${pending ? "opacity-70" : ""}`}>
      {/* Controls: year filter · method toggle on the left, the two exits right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented
            label="Tax year"
            className="flex-wrap"
            value={year == null ? "all" : String(year)}
            options={yearOptions}
            onChange={(v) => setYear(v === "all" ? null : Number(v))}
          />
          <Segmented
            label="Cost-basis method"
            value={globalMethod}
            options={METHODS}
            onChange={chooseMethod}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="#import" className={pill}>
            Import trades
          </a>
          <a href={csvHref} className={pill}>
            <Download size={15} />
            Download CSV
          </a>
        </div>
      </div>

      {empty ? (
        <div className="border-t border-[var(--line-strong)] pt-5">
          <p className="flex items-center gap-2.5 font-display text-lg">
            <Receipt size={20} className="text-[var(--muted)]" />
            No realized gains yet
          </p>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--muted)]">
            Sell transactions in your investment ledger are matched against buy
            lots to compute capital gains. Once you have a completed sale it will
            show up here.
          </p>
        </div>
      ) : (
        <>
          {/* The year's net result, the sentence that splits it, and the split
              itself as one bar. */}
          <section
            aria-label="Total realized"
            className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5"
          >
            <Hero
              className="flex-1 basis-[380px]"
              eyebrow={`Total realized · ${year ?? "all years"}`}
              figure={`${totals.total > 0 ? "+" : ""}${formatCurrency(totals.total)}`}
              tone={gainTone(totals.total) === "muted" ? "default" : gainTone(totals.total)}
              verdict={
                totals.count === 0 ? (
                  <span className="text-[var(--muted)]">No lots closed in {year}.</span>
                ) : (
                  <>
                    {split.split}
                    {split.wash && (
                      <>
                        {" "}
                        {split.wash.lead}{" "}
                        <Mark tone="coral">{formatCurrency(split.wash.amount)}</Mark>{" "}
                        {split.wash.tail}
                      </>
                    )}
                  </>
                )
              }
            />
            <div className="flex min-w-0 flex-1 basis-[360px] flex-col gap-2.5">
              <div
                role="img"
                aria-label={`Long-term ${formatCurrency(totals.longTerm)}, short-term ${formatCurrency(totals.shortTerm)}`}
                className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-[var(--panel-2)]"
              >
                <span className="bg-[var(--jade)]" style={{ width: `${bar.long}%` }} />
                <span className="bg-[var(--brass)]" style={{ width: `${bar.short}%` }} />
              </div>
              <dl className="flex flex-wrap gap-y-2">
                <SplitFigure label="Long-term" swatch="bg-[var(--jade)]" value={totals.longTerm} />
                <SplitFigure label="Short-term" swatch="bg-[var(--brass)]" value={totals.shortTerm} />
                <div className="flex flex-col gap-0.5 border-l border-line pl-6 pt-1.5">
                  <dt className="text-[13px] text-[var(--muted)]">Wash-sale disallowed</dt>
                  <dd
                    className={`mono text-sm ${
                      totals.disallowedWash > 0.005 ? "text-[var(--coral)]" : ""
                    }`}
                  >
                    {formatCurrency(totals.disallowedWash)}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          {/* Lot detail table */}
          <section aria-label="Closed lots" className="space-y-2">
            <div className={ruled.scroll}>
              <table className={`${ruled.table} min-w-[860px]`}>
                <thead>
                  <tr className={`${ruled.headRow} align-bottom`}>
                    <th className="pb-2.5 pr-5 text-left font-normal">
                      <h2 className="font-display text-lg font-semibold tracking-tight text-[var(--paper)]">
                        Closed lots
                        <span className="mono ml-2 text-xs font-normal text-[var(--muted)]">
                          {totals.count}
                        </span>
                      </h2>
                    </th>
                    <th className={ruled.th}>Opened</th>
                    <th className={ruled.th}>Closed</th>
                    <th className={`${ruled.th} text-right`}>Qty</th>
                    <th className={`${ruled.th} text-right`}>Proceeds</th>
                    <th className={`${ruled.th} text-right`}>Basis</th>
                    <th className={`${ruled.th} text-right`}>Gain / loss</th>
                    <th className={ruled.th}>Term</th>
                  </tr>
                </thead>
                <tbody className="mono text-[13px]">
                  {shown.map((l, i) => (
                    <tr key={`${l.sellTxnId}:${l.buyTxnId}:${i}`} className={ruled.row}>
                      <td className={`${ruled.td} font-medium`}>
                        <span>{l.ticker}</span>
                        {l.position === "short" && (
                          <span className="ml-2 rounded border border-line px-1.5 py-0.5 font-sans text-[10px] font-normal uppercase tracking-wide text-[var(--muted)]">
                            written
                          </span>
                        )}
                      </td>
                      <td className={`${ruled.td} whitespace-nowrap text-[var(--muted)]`}>{l.openDate}</td>
                      <td className={`${ruled.td} whitespace-nowrap text-[var(--muted)]`}>{l.closeDate}</td>
                      <td className={`${ruled.td} ${ruled.num}`}>{l.quantity}</td>
                      <td className={`${ruled.td} ${ruled.num}`}>{formatCurrency(l.proceeds)}</td>
                      <td className={`${ruled.td} ${ruled.num}`}>{formatCurrency(l.basis)}</td>
                      <td className={`${ruled.td} ${ruled.num} ${gainClass(l.gain)}`}>
                        {l.gain > 0 ? "+" : ""}
                        {formatCurrency(l.gain)}
                      </td>
                      <td className={`${ruled.td} font-sans text-sm`}>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={l.section1256 ? "text-[var(--brass)]" : undefined}>
                            {l.section1256 ? "1256 · 60/40" : l.term === "long" ? "Long" : "Short"}
                          </span>
                          {l.washSale && (
                            <span
                              title="Wash sale — loss disallowed"
                              className="whitespace-nowrap rounded-full border border-[var(--coral)] px-2 py-px text-[11px] text-[var(--coral)]"
                            >
                              Wash sale
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 font-sans text-sm text-[var(--muted)]">
                        No realized lots in {year}.
                      </td>
                    </tr>
                  ) : (
                    <tr className={ruled.totalRow}>
                      <td className={`${ruled.td} ${ruled.totalLabel}`}>Total</td>
                      <td colSpan={3} />
                      <td className={`${ruled.td} ${ruled.num}`}>{formatCurrency(totals.proceeds)}</td>
                      <td className={`${ruled.td} ${ruled.num}`}>{formatCurrency(totals.basis)}</td>
                      <td className={`${ruled.td} ${ruled.num} ${gainClass(totals.total)}`}>
                        {totals.total > 0 ? "+" : ""}
                        {formatCurrency(totals.total)}
                      </td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line pt-3 text-xs text-[var(--muted)]">
              {globalMethod === "specid"
                ? "Lots are matched Spec-ID: pinned units go to the purchase lot you chose below; unpinned units fall back to FIFO."
                : `Lots are matched ${methodLabel}. Switch to Spec-ID to pin units of a sale to a specific purchase lot; unpinned units fall back to FIFO.`}
            </p>
            {shown.some((l) => l.section1256) && (
              <p className="text-xs leading-relaxed text-[var(--muted)]">
                <span className="text-[var(--brass)]">Section 1256.</span> SPX/SPXW broad-based
                index options are shown with Section 1256 character: 60% long-term and 40%
                short-term, regardless of holding period. The worksheet reconstructs closed ledger
                activity; confirm year-end mark-to-market amounts against Form 1099-B and Form 6781.
              </p>
            )}
          </section>

          {/* Spec-ID override controls — only relevant under spec-ID matching */}
          {globalMethod === "specid" && (
            <section aria-label="Spec-ID lot assignments" className="space-y-4">
              <SectionHead
                title="Spec-ID lot assignments"
                count={overrides.length || undefined}
                action={
                  <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <Pin size={13} /> Pin units of a long-position sale to a specific purchase lot
                  </span>
                }
              />

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
                <ul className="border-t border-line">
                  {overrides.map((o) => {
                    const sell = txnById.get(o.sellTxnId);
                    const buy = txnById.get(o.buyTxnId);
                    return (
                      <li key={o.id} className="flex items-center gap-3 border-b border-line py-2.5 text-sm">
                        <span className="mono min-w-0 flex-1 truncate text-xs text-[var(--muted)]">
                          {o.quantity} units · {sell ? txnLabel(sell) : o.sellTxnId} ←{" "}
                          {buy ? txnLabel(buy) : o.buyTxnId}
                        </span>
                        <button
                          onClick={() => dropOverride(o.id)}
                          aria-label="Remove pin"
                          className="shrink-0 rounded-md p-1.5 text-[var(--muted)] transition hover:text-[var(--coral)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** One side of the long/short split: a swatch that keys it to the bar, and the figure. */
function SplitFigure({ label, swatch, value }: { label: string; swatch: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 border-l border-line px-6 pt-1.5 first:border-l-0 first:pl-0">
      <dt className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
        <span aria-hidden className={`h-2 w-2 rounded-[3px] ${swatch}`} />
        {label}
      </dt>
      <dd className={`mono text-sm ${value < -0.005 ? "text-[var(--coral)]" : ""}`}>
        {value > 0 ? "+" : ""}
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

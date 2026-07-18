"use client";

/**
 * Manual corporate-action (stock split) editor. Splits are applied at read time
 * before trades reach the tax-lot engine (lib/import/splits.ts), so adding one
 * here retroactively corrects the basis of imported pre-split history without
 * re-importing. Ratio is shares-after : shares-before (a 4-for-1 is 4 and 1).
 */

import { useState, useTransition } from "react";
import { Plus, Trash2, Loader2, Split } from "lucide-react";
import { Card } from "@/components/ui/card";
import { addStockSplitAction, deleteStockSplitAction } from "@/lib/actions-import";

type SplitRow = { id: string; ticker: string; date: string; numerator: number; denominator: number };

const ghost =
  "inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-[var(--paper)] transition hover:border-[var(--brass-dim)] disabled:opacity-50";

export function StockSplits({ splits }: { splits: SplitRow[] }) {
  const [pending, start] = useTransition();
  const [ticker, setTicker] = useState("");
  const [date, setDate] = useState("");
  const [numerator, setNumerator] = useState("");
  const [denominator, setDenominator] = useState("1");
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    start(async () => {
      const res = await addStockSplitAction({
        ticker,
        date,
        numerator: Number(numerator),
        denominator: Number(denominator),
      });
      if ("error" in res) setError(res.error);
      else {
        setTicker("");
        setDate("");
        setNumerator("");
        setDenominator("1");
      }
    });
  }

  return (
    <Card className="p-6">
      <p className="flex items-center gap-2 eyebrow">
        <Split size={13} className="text-[var(--brass)]" /> Corporate actions
      </p>
      <h3 className="mt-2 font-display text-xl">Stock splits</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Add a split so imported pre-split trades reconcile with post-split shares. Applied everywhere
        automatically — a 4-for-1 is numerator <b>4</b>, denominator <b>1</b>.
      </p>

      {splits.length > 0 && (
        <ul className="mt-4 divide-y divide-line/60">
          {splits.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
              <span className="tabular">
                <b className="font-medium">{s.ticker}</b> · {s.numerator}-for-{s.denominator} · {s.date}
              </span>
              <button
                className="text-[var(--muted)] transition hover:text-[var(--coral)] disabled:opacity-50"
                disabled={pending}
                onClick={() => start(async () => void (await deleteStockSplitAction(s.id)))}
                aria-label={`Delete ${s.ticker} split`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL"
          className="w-24 rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm"
        />
        <input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          placeholder="YYYY-MM-DD"
          className="w-36 rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm tabular"
        />
        <div className="flex items-center gap-1.5 tabular">
          <input
            value={numerator}
            onChange={(e) => setNumerator(e.target.value)}
            placeholder="4"
            className="w-14 rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm"
          />
          <span className="text-[var(--muted)]">for</span>
          <input
            value={denominator}
            onChange={(e) => setDenominator(e.target.value)}
            placeholder="1"
            className="w-14 rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm"
          />
        </div>
        <button className={ghost} onClick={add} disabled={pending}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-[var(--coral)]">{error}</p>}
    </Card>
  );
}

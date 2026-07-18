"use client";

/**
 * Manual corporate-action (stock split) editor. Splits are applied at read time
 * before trades reach the tax-lot engine (lib/import/splits.ts), so adding one
 * here retroactively corrects the basis of imported pre-split history without
 * re-importing. Ratio is shares-after : shares-before (a 4-for-1 is 4 and 1).
 */

import { useState, useTransition } from "react";
import { Plus, Trash2, Loader2, Split, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { addStockSplitAction, deleteStockSplitAction, detectSplitsAction } from "@/lib/actions-import";
import type { SplitSuggestion } from "@/lib/import/split-detect";

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
  const [suggestions, setSuggestions] = useState<SplitSuggestion[] | null>(null);
  const [detecting, setDetecting] = useState(false);

  function detect() {
    setError(null);
    setDetecting(true);
    start(async () => {
      const res = await detectSplitsAction();
      setDetecting(false);
      if ("error" in res) setError(res.error);
      else setSuggestions(res);
    });
  }

  function addSuggestion(s: SplitSuggestion) {
    start(async () => {
      await addStockSplitAction({ ticker: s.ticker, date: s.date, numerator: s.numerator, denominator: s.denominator });
      setSuggestions((prev) => prev?.filter((x) => !(x.ticker === s.ticker && x.date === s.date)) ?? null);
    });
  }

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

      <button className={`${ghost} mt-4`} onClick={detect} disabled={pending}>
        {detecting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        Auto-detect from imported symbols
      </button>

      {suggestions && suggestions.length === 0 && (
        <p className="mt-3 text-sm text-[var(--muted)]">No missing splits found for your imported tickers.</p>
      )}
      {suggestions && suggestions.length > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--jade)]/30 bg-[var(--jade)]/6 p-3">
          <p className="text-sm font-medium text-[var(--jade)]">
            {suggestions.length} split{suggestions.length === 1 ? "" : "s"} found — add the ones that apply:
          </p>
          <ul className="mt-2 space-y-1.5">
            {suggestions.map((s) => (
              <li key={`${s.ticker}-${s.date}`} className="flex items-center justify-between text-sm tabular">
                <span>
                  <b className="font-medium">{s.ticker}</b> · {s.numerator}-for-{s.denominator} · {s.date}
                </span>
                <button
                  className="inline-flex items-center gap-1 text-xs text-[var(--jade)] hover:underline disabled:opacity-50"
                  disabled={pending}
                  onClick={() => addSuggestion(s)}
                >
                  <Plus size={13} /> Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

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

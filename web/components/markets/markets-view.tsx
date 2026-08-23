"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowUpRight, Plus, RefreshCw, Settings2, X } from "lucide-react";
import { CandleChart } from "@/components/markets/candle-chart";
import { HullSettingsPanel } from "@/components/markets/hull-settings-panel";
import { hullSuite, hullTrend, type Bar, type HullPoint, type HullTrend } from "@/lib/hull";
import { TIMEFRAMES, type MarketsPrefs } from "@/lib/markets-prefs";
import { addWatchlistSymbol, removeWatchlistSymbol, saveMarketsPrefs } from "@/lib/actions-markets";
import type { BarMeta, BarSeries } from "@/lib/yahoo";

/**
 * The markets desk — one Hull read across a whole watchlist.
 *
 * The organising idea is that the *rail* is the product and the charts are the
 * detail view. A grid of charts alone doesn't scale past four symbols; a column
 * that says "SPY flipped up 12 bars ago, NVDA flipped down 2 bars ago" does, and
 * sorting that column by flip recency is the fastest way to see what changed
 * since you last looked.
 *
 * Everything is derived from one array of bars per symbol: the candles, the
 * band, the trend chip, and the day change all read the same `hullSuite` output.
 */

export type MarketsViewProps = {
  symbols: string[];
  series: Record<string, BarSeries>;
  prefs: MarketsPrefs;
};

type Row = {
  symbol: string;
  bars: Bar[];
  points: HullPoint[];
  trend: HullTrend;
  meta: BarMeta | null;
  last: number | null;
  dayChange: number | null;
};

/** How tall each chart is at a given grid density. */
const CHART_HEIGHT: Record<1 | 2 | 3, number> = { 1: 460, 2: 340, 3: 280 };

/** A flip this recent is "new" — highlighted in the rail and counted up top. */
const FRESH_FLIP_BARS = 3;

/** Intraday bars go stale in a minute; daily-and-slower don't. */
const REFRESH_MS = 60_000;

function fmtNum(v: number | null): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

export function MarketsView({ symbols: initialSymbols, series: initialSeries, prefs: initialPrefs }: MarketsViewProps) {
  const [symbols, setSymbols] = useState(initialSymbols);
  const [series, setSeries] = useState(initialSeries);
  const [prefs, setPrefs] = useState(initialPrefs);

  const [loading, setLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sort, setSort] = useState<"list" | "flip" | "change">("list");
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  // ── data ──────────────────────────────────────────────────────────────────
  const timeframe = `${prefs.range}|${prefs.interval}`;
  const loaded = useRef({ timeframe, symbols: new Set(initialSymbols) });

  const load = useCallback(
    async (syms: string[], range: string, interval: string, showSpinner: boolean) => {
      if (syms.length === 0) {
        setSeries({});
        return;
      }
      if (showSpinner) setLoading(true);
      try {
        const res = await fetch(
          `/api/bars?symbols=${encodeURIComponent(syms.join(","))}&range=${range}&interval=${interval}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as { series: Record<string, BarSeries> };
        setSeries(json.series ?? {});
      } catch {
        // Leave the previous series on screen — a stale chart beats a blank one.
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [],
  );

  // Refetch when the timeframe changes or a symbol appears that we have no bars
  // for. Removing a symbol deliberately doesn't refetch — the remaining series
  // are already correct, and `rows` only maps over `symbols`. The initial render
  // arrives with server-fetched data, so this doesn't fire on mount either.
  useEffect(() => {
    const stale =
      loaded.current.timeframe !== timeframe || symbols.some((s) => !loaded.current.symbols.has(s));
    loaded.current = { timeframe, symbols: new Set(symbols) };
    if (!stale) return;
    void load(symbols, prefs.range, prefs.interval, true);
  }, [timeframe, symbols, prefs.range, prefs.interval, load]);

  // Quiet auto-refresh. The API route is backed by Next's Data Cache (60s for
  // intraday, 10m otherwise), so this polls the cache, not Yahoo.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(symbols, prefs.range, prefs.interval, false);
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [symbols, prefs.range, prefs.interval, load]);

  // ── prefs ─────────────────────────────────────────────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updatePrefs = useCallback((next: MarketsPrefs) => {
    setPrefs(next);
    // Debounced: dragging the length-multiplier slider shouldn't write on every
    // frame. The UI already has the new value; the write only has to outlive it.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveMarketsPrefs(next), 600);
  }, []);
  useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), []);

  // ── derived ───────────────────────────────────────────────────────────────
  const rows: Row[] = useMemo(
    () =>
      symbols.map((symbol) => {
        const s = series[symbol];
        const bars = s?.bars ?? [];
        const points = hullSuite(bars, prefs.hull);
        const trend = hullTrend(bars, points);
        const meta = s?.meta ?? null;
        const last = meta?.regularMarketPrice ?? bars[bars.length - 1]?.close ?? null;
        // Yahoo's `previousClose` is the prior *session's* close, which is the
        // right denominator on an intraday chart where the last bar is minutes old.
        const prev = meta?.previousClose ?? (bars.length > 1 ? bars[bars.length - 2].close : null);
        return {
          symbol,
          bars,
          points,
          trend,
          meta,
          last,
          dayChange: last != null && prev ? last / prev - 1 : null,
        };
      }),
    [symbols, series, prefs.hull],
  );

  const railRows = useMemo(() => {
    const copy = [...rows];
    if (sort === "flip") {
      // Most recent flip first; symbols with no readable trend sink to the end.
      copy.sort((a, b) => (a.trend.barsSince ?? Infinity) - (b.trend.barsSince ?? Infinity));
    } else if (sort === "change") {
      copy.sort((a, b) => (b.dayChange ?? -Infinity) - (a.dayChange ?? -Infinity));
    }
    return copy;
  }, [rows, sort]);

  const tally = useMemo(() => {
    let up = 0;
    let down = 0;
    let fresh = 0;
    for (const r of rows) {
      if (r.trend.direction === "up") up++;
      else if (r.trend.direction === "down") down++;
      if (r.trend.barsSince != null && r.trend.barsSince <= FRESH_FLIP_BARS) fresh++;
    }
    return { up, down, fresh };
  }, [rows]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const add = (raw: string) => {
    setAddError(null);
    startTransition(async () => {
      const result = await addWatchlistSymbol(raw);
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setDraft("");
      setSymbols(result.symbols);
    });
  };

  const remove = (symbol: string) => {
    // Optimistic: the rail and grid drop the symbol immediately, and the action
    // returns the authoritative list.
    setSymbols((prev) => prev.filter((s) => s !== symbol));
    startTransition(async () => setSymbols(await removeWatchlistSymbol(symbol)));
  };

  const active = TIMEFRAMES.find((t) => t.range === prefs.range && t.interval === prefs.interval);

  return (
    <div className="space-y-4">
      {/* ── toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Timeframe"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {TIMEFRAMES.map((t) => {
            const on = active?.label === t.label;
            return (
              <button
                key={t.label}
                type="button"
                aria-pressed={on}
                title={`${t.range} of ${t.interval} bars`}
                onClick={() => updatePrefs({ ...prefs, range: t.range, interval: t.interval })}
                className={`shrink-0 rounded-full border px-3 py-1 font-mono text-xs transition ${
                  on
                    ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                    : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-line bg-[var(--panel)] p-0.5">
            {([1, 2, 3] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={prefs.columns === c}
                title={`${c} chart${c > 1 ? "s" : ""} per row`}
                onClick={() => updatePrefs({ ...prefs, columns: c })}
                className={`rounded-full px-2.5 py-1 font-mono text-xs transition ${
                  prefs.columns === c ? "bg-[var(--panel-2)] text-[var(--paper)]" : "text-[var(--muted)]"
                }`}
              >
                {c}×
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void load(symbols, prefs.range, prefs.interval, true)}
            title="Refresh bars"
            className="rounded-full border border-line p-1.5 text-[var(--muted)] transition hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
          </button>

          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
              showSettings
                ? "border-[var(--brass-dim)] bg-[var(--panel-2)] text-[var(--paper)]"
                : "border-line text-[var(--muted)] hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
            }`}
          >
            <Settings2 size={14} />
            Hull {prefs.hull.mode.toUpperCase()} {Math.trunc(prefs.hull.length * prefs.hull.lengthMult)}
          </button>
        </div>
      </div>

      {showSettings && <HullSettingsPanel prefs={prefs} onChange={updatePrefs} />}

      <div className="grid gap-4 lg:grid-cols-[268px_minmax(0,1fr)]">
        {/* ── watchlist rail ───────────────────────────────────────────── */}
        <aside className="flex flex-col gap-3 self-start rounded-[var(--radius)] border border-line bg-[var(--panel)] p-3 lg:sticky lg:top-4">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <span className="eyebrow">Watchlist</span>
            <span className="font-mono text-[10px] text-[var(--muted)]">
              <span style={{ color: "var(--jade)" }}>{tally.up}▲</span>{" "}
              <span style={{ color: "var(--coral)" }}>{tally.down}▼</span>
              {tally.fresh > 0 && (
                <span className="ml-1.5 text-[var(--brass)]">{tally.fresh} new</span>
              )}
            </span>
          </div>

          <div className="flex gap-1 px-1">
            {(
              [
                { id: "list", label: "Order" },
                { id: "flip", label: "Flips" },
                { id: "change", label: "Change" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sort === s.id}
                onClick={() => setSort(s.id)}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                  sort === s.id
                    ? "border-[var(--brass-dim)] text-[var(--paper)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <ul className="flex flex-col">
            {railRows.map((r) => (
              <RailRow key={r.symbol} row={r} onRemove={() => remove(r.symbol)} />
            ))}
            {railRows.length === 0 && (
              <li className="px-1 py-6 text-center text-xs text-[var(--faint)]">
                No symbols yet.
              </li>
            )}
          </ul>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              add(draft);
            }}
            className="flex items-center gap-1.5 border-t border-line pt-3"
          >
            <input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setAddError(null);
              }}
              placeholder="Add ticker"
              aria-label="Add a ticker to the watchlist"
              autoCapitalize="characters"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 font-mono text-xs uppercase text-[var(--paper)] outline-none placeholder:normal-case placeholder:text-[var(--faint)] focus:border-[var(--brass-dim)]"
            />
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              className="rounded-lg border border-line p-1.5 text-[var(--muted)] transition hover:border-[var(--brass-dim)] hover:text-[var(--paper)] disabled:opacity-40"
              aria-label="Add"
            >
              <Plus size={14} />
            </button>
          </form>
          {addError && <p className="px-1 text-[10px] text-[var(--coral)]">{addError}</p>}
        </aside>

        {/* ── chart grid ───────────────────────────────────────────────── */}
        <div
          className={`grid gap-4 ${
            prefs.columns === 1
              ? "grid-cols-1"
              : prefs.columns === 2
                ? "grid-cols-1 xl:grid-cols-2"
                : "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3"
          }`}
        >
          {rows.map((r) => (
            <ChartCard
              key={r.symbol}
              row={r}
              prefs={prefs}
              height={CHART_HEIGHT[prefs.columns]}
              onRemove={() => remove(r.symbol)}
            />
          ))}
          {rows.length === 0 && (
            <div className="rounded-[var(--radius)] border border-dashed border-line p-12 text-center">
              <p className="text-sm text-[var(--muted)]">Your watchlist is empty.</p>
              <p className="mt-1 text-xs text-[var(--faint)]">
                Add a ticker on the left to chart it with the Hull Suite.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The trend column: direction, age, and what the move is worth since the flip. */
function TrendChip({ trend, compact = false }: { trend: HullTrend; compact?: boolean }) {
  if (!trend.direction) {
    return <span className="font-mono text-[10px] text-[var(--faint)]">no read</span>;
  }
  const up = trend.direction === "up";
  const fresh = trend.barsSince != null && trend.barsSince <= FRESH_FLIP_BARS;
  const color = up ? "var(--jade)" : "var(--coral)";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
        fresh ? "ring-1" : ""
      }`}
      style={{
        color,
        background: fresh ? "color-mix(in srgb, currentColor 12%, transparent)" : undefined,
      }}
      title={
        `Hull turned ${trend.direction} ${trend.barsSince} bar${trend.barsSince === 1 ? "" : "s"} ago` +
        (trend.flipPrice != null ? ` at ${fmtNum(trend.flipPrice)}` : "") +
        (trend.changeSinceFlip != null ? ` · ${fmtPct(trend.changeSinceFlip)} since` : "")
      }
    >
      {up ? "▲" : "▼"}
      {trend.barsSince != null && <span>{trend.barsSince}</span>}
      {!compact && trend.changeSinceFlip != null && (
        <span className="text-[var(--muted)]">{fmtPct(trend.changeSinceFlip)}</span>
      )}
    </span>
  );
}

function RailRow({ row, onRemove }: { row: Row; onRemove: () => void }) {
  const up = (row.dayChange ?? 0) >= 0;
  return (
    <li className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition hover:bg-[var(--panel-2)]">
      <a href={`#chart-${row.symbol}`} className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-xs text-[var(--paper)]">{row.symbol}</span>
          <span className="shrink-0 font-mono text-xs tabular text-[var(--paper)]">
            {fmtNum(row.last)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <TrendChip trend={row.trend} compact />
          <span
            className="shrink-0 font-mono text-[10px] tabular"
            style={{ color: row.dayChange == null ? "var(--faint)" : up ? "var(--jade)" : "var(--coral)" }}
          >
            {fmtPct(row.dayChange)}
          </span>
        </div>
      </a>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${row.symbol}`}
        className="shrink-0 rounded p-0.5 text-[var(--faint)] opacity-0 transition hover:text-[var(--coral)] focus:opacity-100 group-hover:opacity-100"
      >
        <X size={12} />
      </button>
    </li>
  );
}

function ChartCard({
  row,
  prefs,
  height,
  onRemove,
}: {
  row: Row;
  prefs: MarketsPrefs;
  height: number;
  onRemove: () => void;
}) {
  const up = (row.dayChange ?? 0) >= 0;
  return (
    <section
      id={`chart-${row.symbol}`}
      className="scroll-mt-4 overflow-hidden rounded-[var(--radius)] border border-line bg-[var(--panel)]"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <h2 className="font-display text-lg leading-none">{row.symbol}</h2>
        <span className="font-mono text-sm tabular text-[var(--paper)]">{fmtNum(row.last)}</span>
        <span
          className="font-mono text-xs tabular"
          style={{ color: row.dayChange == null ? "var(--faint)" : up ? "var(--jade)" : "var(--coral)" }}
        >
          {fmtPct(row.dayChange)}
        </span>
        <TrendChip trend={row.trend} />
        <span className="ml-auto flex items-center gap-2.5">
          {row.meta?.exchangeName && (
            <span className="hidden text-[10px] text-[var(--faint)] sm:inline">
              {row.meta.exchangeName}
              {row.meta.currency ? ` · ${row.meta.currency}` : ""}
            </span>
          )}
          <Link
            href={`/investments/options/chain?ticker=${encodeURIComponent(row.symbol)}`}
            className="flex items-center gap-0.5 text-[10px] text-[var(--muted)] transition hover:text-[var(--paper)]"
          >
            Chain <ArrowUpRight size={10} />
          </Link>
          <Link
            href={`/fundamentals?ticker=${encodeURIComponent(row.symbol)}`}
            className="flex items-center gap-0.5 text-[10px] text-[var(--muted)] transition hover:text-[var(--paper)]"
          >
            Financials <ArrowUpRight size={10} />
          </Link>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${row.symbol}`}
            className="rounded p-0.5 text-[var(--faint)] transition hover:text-[var(--coral)]"
          >
            <X size={13} />
          </button>
        </span>
      </header>

      <CandleChart
        bars={row.bars}
        points={row.points}
        showBand={prefs.showBand}
        colorCandles={prefs.colorCandles}
        showVolume={prefs.showVolume}
        interval={prefs.interval}
        height={height}
      />
    </section>
  );
}

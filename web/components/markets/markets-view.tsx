"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, ArrowUpRight, RefreshCw, Search, Settings2, X } from "lucide-react";
import { CandleChart } from "@/components/markets/candle-chart";
import { HullSettingsPanel } from "@/components/markets/hull-settings-panel";
import { pill, Segmented } from "@/components/portfolio/ruled";
import { Mark, SectionHead, Verdict } from "@/components/ui/statement";
import { cn } from "@/lib/utils";
import { hullSuite, hullTrend, type Bar, type HullPoint, type HullTrend } from "@/lib/hull";
import { TIMEFRAMES, sourceFor, type MarketsPrefs, type SymbolSources } from "@/lib/markets-prefs";
import {
  addWatchlistSymbol,
  clearMarketSymbolSource,
  removeWatchlistSymbol,
  saveMarketsPrefs,
  searchMarketSymbols,
  setMarketSymbolSource,
} from "@/lib/actions-markets";
import type { BarMeta, BarSeries, SymbolMatch } from "@/lib/yahoo";

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
  /** Symbols on the desk because the portfolio holds them, not because they were pinned. */
  derived: string[];
  /** display-symbol → source-symbol redirects for symbols that didn't chart. */
  sources: SymbolSources;
  /** Keyed by *source* symbol — see `sourceFor`. */
  series: Record<string, BarSeries>;
  prefs: MarketsPrefs;
};

type Row = {
  symbol: string;
  /** The symbol the bars were actually fetched under. Equal to `symbol` unless redirected. */
  source: string;
  bars: Bar[];
  points: HullPoint[];
  trend: HullTrend;
  meta: BarMeta | null;
  last: number | null;
  dayChange: number | null;
  /** No bars came back — the symbol doesn't chart under its current source. */
  missing: boolean;
  /** Held, so removing it is a dismissal rather than an un-pin. */
  held: boolean;
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

export function MarketsView({
  symbols: initialSymbols,
  derived,
  sources: initialSources,
  series: initialSeries,
  prefs: initialPrefs,
}: MarketsViewProps) {
  const [symbols, setSymbols] = useState(initialSymbols);
  const [sources, setSources] = useState(initialSources);
  const [series, setSeries] = useState(initialSeries);
  const [prefs, setPrefs] = useState(initialPrefs);

  const [loading, setLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuggestions, setAddSuggestions] = useState<SymbolMatch[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [sort, setSort] = useState<"list" | "flip" | "change">("list");
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  const held = useMemo(() => new Set(derived), [derived]);

  // Everything downstream reads bars by source, so resolve once per render.
  const resolved = useMemo(() => symbols.map((s) => sourceFor(s, sources)), [symbols, sources]);

  // ── data ──────────────────────────────────────────────────────────────────
  const timeframe = `${prefs.range}|${prefs.interval}`;
  const loaded = useRef({ timeframe, symbols: new Set(resolved) });

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

  // Refetch when the timeframe changes or a source appears that we have no bars
  // for — which covers both adding a symbol and redirecting one at a new source.
  // Removing a symbol deliberately doesn't refetch: the remaining series are
  // already correct, and `rows` only maps over `symbols`. The initial render
  // arrives with server-fetched data, so this doesn't fire on mount either.
  useEffect(() => {
    const stale =
      loaded.current.timeframe !== timeframe || resolved.some((s) => !loaded.current.symbols.has(s));
    loaded.current = { timeframe, symbols: new Set(resolved) };
    if (!stale) return;
    void load(resolved, prefs.range, prefs.interval, true);
  }, [timeframe, resolved, prefs.range, prefs.interval, load]);

  // Quiet auto-refresh. The API route is backed by Next's Data Cache (60s for
  // intraday, 10m otherwise), so this polls the cache, not Yahoo.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        void load(resolved, prefs.range, prefs.interval, false);
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [resolved, prefs.range, prefs.interval, load]);

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
        const source = sourceFor(symbol, sources);
        const s = series[source];
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
          source,
          bars,
          points,
          trend,
          meta,
          last,
          dayChange: last != null && prev ? last / prev - 1 : null,
          // Only a *fetched* empty series is missing data. Before the first
          // fetch for a newly added symbol lands there's no entry at all, and
          // calling that "no data" would flash a false alarm.
          missing: s != null && bars.length === 0,
          held: held.has(symbol),
        };
      }),
    [symbols, sources, series, prefs.hull, held],
  );

  /** Symbols the desk holds but can't chart — the banner above the grid. */
  const unresolved = useMemo(() => rows.filter((r) => r.missing), [rows]);

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
    setAddSuggestions([]);
    startTransition(async () => {
      const result = await addWatchlistSymbol(raw);
      if (!result.ok) {
        setAddError(result.error);
        setAddSuggestions(result.suggestions ?? []);
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

  /** Point a symbol at a different source, then pull its bars under it. */
  const retarget = useCallback(
    async (symbol: string, source: string): Promise<string | null> => {
      const result = await setMarketSymbolSource(symbol, source);
      if (!result.ok) return result.error;
      setSources(result.sources);
      // `resolved` changes on the next render and the stale-check effect fetches
      // the new source, so nothing more is needed here.
      return null;
    },
    [],
  );

  const clearSource = useCallback((symbol: string) => {
    startTransition(async () => setSources(await clearMarketSymbolSource(symbol)));
  }, []);

  const active = TIMEFRAMES.find((t) => t.range === prefs.range && t.interval === prefs.interval);

  // The sentence under the figure: what changed most recently, then who is
  // on the wrong side of the band. Both read straight off `rows`.
  const read = useMemo(() => {
    const readable = rows.filter((r) => r.trend.direction != null);
    let freshest: Row | null = null;
    for (const r of readable) {
      if (r.trend.barsSince == null) continue;
      if (!freshest || r.trend.barsSince < (freshest.trend.barsSince ?? Infinity)) freshest = r;
    }
    return {
      readable: readable.length,
      freshest,
      down: readable.filter((r) => r.trend.direction === "down").map((r) => r.symbol),
    };
  }, [rows]);

  return (
    <div className="space-y-9">
      {/* ── the read, and the controls that change it ─────────────────── */}
      <section
        aria-label="Watchlist read"
        className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5"
      >
        <div className="flex min-w-0 flex-1 basis-[380px] flex-col gap-3.5">
          <p className="eyebrow">Watchlist trend</p>
          <p className="display-1 font-display text-5xl tabular sm:text-6xl">
            {tally.up} of {rows.length}
            <span className="text-2xl tracking-normal text-[var(--muted)]"> trending up</span>
          </p>
          <Verdict>
            {rows.length === 0 ? (
              <span className="text-[var(--muted)]">
                Nothing on the desk yet. Positions you hold appear here automatically.
              </span>
            ) : read.freshest == null ? (
              <span className="text-[var(--muted)]">
                Not enough bars at this timeframe for a Hull read.
              </span>
            ) : (
              <>
                <Mark tone={read.freshest.trend.direction === "up" ? "jade" : "coral"}>
                  {read.freshest.symbol} turned {read.freshest.trend.direction}{" "}
                  {read.freshest.trend.barsSince === 0
                    ? "on the latest bar"
                    : `${read.freshest.trend.barsSince} ${
                        read.freshest.trend.barsSince === 1 ? "bar" : "bars"
                      } ago`}
                  .
                </Mark>{" "}
                {read.down.length === 0
                  ? "Nothing is under its Hull band."
                  : read.down.length === read.readable
                    ? "Every name is under its Hull band."
                    : read.down.length === 1
                      ? `${read.down[0]} is the only name under its Hull band.`
                      : read.down.length <= 3
                        ? `${read.down.slice(0, -1).join(", ")} and ${
                            read.down[read.down.length - 1]
                          } are the only names under their Hull band.`
                        : `${read.down.length} names are under their Hull band.`}
                {tally.fresh > 0 && (
                  <span className="text-[var(--muted)]">
                    {" "}
                    {tally.fresh} flipped within {FRESH_FLIP_BARS} bars.
                  </span>
                )}
              </>
            )}
          </Verdict>
        </div>

        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Segmented
            label="Timeframe"
            className="max-w-full overflow-x-auto"
            value={active?.label ?? ""}
            options={TIMEFRAMES.map((t) => ({ value: t.label, label: t.label }))}
            onChange={(label) => {
              const t = TIMEFRAMES.find((x) => x.label === label);
              if (t) updatePrefs({ ...prefs, range: t.range, interval: t.interval });
            }}
          />
          <Segmented
            label="Charts per row"
            value={String(prefs.columns) as "1" | "2" | "3"}
            options={[
              { value: "1", label: "1×" },
              { value: "2", label: "2×" },
              { value: "3", label: "3×" },
            ]}
            onChange={(c) => updatePrefs({ ...prefs, columns: Number(c) as 1 | 2 | 3 })}
          />
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings}
            className={cn(pill, "mono text-xs", showSettings && "bg-[var(--panel-2)]")}
          >
            <Settings2 size={14} />
            Hull {prefs.hull.mode.toUpperCase()} {Math.trunc(prefs.hull.length * prefs.hull.lengthMult)}
          </button>
          <button
            type="button"
            onClick={() => void load(symbols, prefs.range, prefs.interval, true)}
            aria-label="Refresh bars"
            title="Refresh bars"
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-[var(--muted)] transition-colors hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
          </button>
        </div>
      </section>

      {showSettings && <HullSettingsPanel prefs={prefs} onChange={updatePrefs} />}

      {/* The desk holds these but can't chart them. Says so once, up top, rather
          than leaving the user to notice N blank charts further down. */}
      {unresolved.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-y border-[var(--brass-dim)] py-2.5">
          <AlertTriangle size={14} className="shrink-0 text-[var(--brass)]" />
          <p className="text-[13px] text-[var(--muted)]">
            No market data for{" "}
            {unresolved.length === 1 ? (
              <span className="mono text-[var(--paper)]">{unresolved[0].symbol}</span>
            ) : (
              <span className="text-[var(--paper)]">{unresolved.length} symbols</span>
            )}
            . Pick a different source below, or remove them from the desk.
          </p>
          <span className="flex flex-wrap gap-1.5">
            {unresolved.map((r) => (
              <a
                key={r.symbol}
                href={`#chart-${r.symbol}`}
                className="mono rounded-full border border-line px-2 py-0.5 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--brass-dim)] hover:text-[var(--paper)]"
              >
                {r.symbol}
              </a>
            ))}
          </span>
        </div>
      )}

      <div
        className={cn(
          "grid gap-x-12 gap-y-9",
          // One chart per row keeps the render's 2:3 split; denser grids hand
          // the charts the room instead.
          prefs.columns === 1
            ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
            : "lg:grid-cols-[minmax(300px,1fr)_minmax(0,3fr)]",
        )}
      >
        {/* ── watchlist ────────────────────────────────────────────────── */}
        <section aria-label="Watchlist" className="flex min-w-0 flex-col self-start lg:sticky lg:top-4">
          <SectionHead
            title="Watchlist"
            count={rows.length}
            className="items-center"
            action={
              <Segmented
                label="Sort"
                value={sort}
                options={[
                  { value: "list", label: "Order" },
                  { value: "flip", label: "Flips" },
                  { value: "change", label: "Change" },
                ]}
                onChange={setSort}
              />
            }
          />
          <div className="overflow-x-auto">
            <ul className="min-w-[360px]">
              {railRows.map((r) => (
                <RailRow key={r.symbol} row={r} onRemove={() => remove(r.symbol)} />
              ))}
              {railRows.length === 0 && (
                <li className="border-b border-line py-6 text-center text-[13px] text-[var(--muted)]">
                  No symbols yet.
                </li>
              )}
            </ul>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              add(draft);
            }}
            className="flex gap-2 pt-3.5"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-[var(--muted)]">
              Add a ticker to the watchlist
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setAddError(null);
                  setAddSuggestions([]);
                }}
                placeholder="Symbol or company name"
                autoCapitalize="characters"
                autoComplete="off"
                className="mono min-h-10 w-full rounded-xl border border-line bg-[var(--panel)] px-3.5 text-sm uppercase text-[var(--paper)] outline-none placeholder:font-sans placeholder:normal-case placeholder:text-[var(--muted)] focus:border-[var(--brass-dim)]"
              />
            </label>
            <button
              type="submit"
              disabled={pending || !draft.trim()}
              className={cn(pill, "self-end")}
            >
              Add
            </button>
          </form>
          {addError && <p className="pt-2 text-xs text-[var(--coral)]">{addError}</p>}
          {addSuggestions.length > 0 && (
            <ul className="flex flex-col pt-1">
              {addSuggestions.map((m) => (
                <li key={m.symbol} className="border-b border-line">
                  <button
                    type="button"
                    onClick={() => add(m.symbol)}
                    className="w-full py-2 text-left transition-colors hover:bg-[var(--panel)]"
                  >
                    <SymbolMatchLabel match={m} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-2.5 text-xs text-[var(--muted)]">
            The chip reads direction, bars since the Hull flip, and the move since.
          </p>
        </section>

        {/* ── charts ───────────────────────────────────────────────────── */}
        <div
          className={cn(
            "grid min-w-0 gap-x-10 gap-y-9 self-start",
            prefs.columns === 1
              ? "grid-cols-1"
              : prefs.columns === 2
                ? "grid-cols-1 xl:grid-cols-2"
                : "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3",
          )}
        >
          {rows.map((r) => (
            <ChartSection
              key={r.symbol}
              row={r}
              prefs={prefs}
              height={CHART_HEIGHT[prefs.columns]}
              onRemove={() => remove(r.symbol)}
              onRetarget={retarget}
              onClearSource={() => clearSource(r.symbol)}
            />
          ))}
          {rows.length === 0 && (
            <div className="border-y border-line py-12 text-center">
              <p className="text-sm text-[var(--muted)]">Nothing on the desk.</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Positions you hold appear here automatically. Add a ticker to the watchlist to
                chart one you don&apos;t.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const SIGNED: Record<"up" | "down" | "none", string> = {
  up: "text-[var(--jade)]",
  down: "text-[var(--coral)]",
  none: "text-[var(--muted)]",
};

function signTone(v: number | null): string {
  return SIGNED[v == null ? "none" : v >= 0 ? "up" : "down"];
}

/** The trend column: direction, bars since the flip, and the move since. */
function TrendChip({ trend }: { trend: HullTrend }) {
  if (!trend.direction) {
    return <span className="mono text-[11px] text-[var(--muted)]">no read</span>;
  }
  const up = trend.direction === "up";
  const fresh = trend.barsSince != null && trend.barsSince <= FRESH_FLIP_BARS;
  return (
    <span
      className={cn(
        "mono inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px]",
        up
          ? "border-[var(--jade)] text-[var(--jade)]"
          : "border-[var(--coral)] text-[var(--coral)]",
        fresh &&
          (up
            ? "bg-[color-mix(in_srgb,var(--jade)_14%,transparent)]"
            : "bg-[color-mix(in_srgb,var(--coral)_14%,transparent)]"),
      )}
      title={trendSentence(trend)}
    >
      {up ? "↑" : "↓"}
      {trend.barsSince != null && <> {trend.barsSince}</>}
      {trend.changeSinceFlip != null && <> · {fmtPct(trend.changeSinceFlip)}</>}
    </span>
  );
}

/** "Hull turned up 14 bars ago at 220.60 · +3.90% since" */
function trendSentence(trend: HullTrend): string {
  if (!trend.direction) return "No Hull read at this timeframe";
  return (
    `Hull turned ${trend.direction} ${trend.barsSince} bar${trend.barsSince === 1 ? "" : "s"} ago` +
    (trend.flipPrice != null ? ` at ${fmtNum(trend.flipPrice)}` : "") +
    (trend.changeSinceFlip != null ? ` · ${fmtPct(trend.changeSinceFlip)} since` : "")
  );
}

function RailRow({ row, onRemove }: { row: Row; onRemove: () => void }) {
  return (
    <li className="group mono flex min-h-[52px] items-center gap-1 border-b border-line text-[13px] transition-colors hover:bg-[var(--panel)]">
      <a
        href={`#chart-${row.symbol}`}
        className="grid min-w-0 flex-1 grid-cols-[minmax(90px,1fr)_90px_70px_132px] items-center gap-3 self-stretch pl-2"
        title={row.source !== row.symbol ? `${row.symbol} charted from ${row.source}` : undefined}
      >
        <span className="truncate font-medium text-[var(--paper)]">
          {row.symbol}
          {row.source !== row.symbol && (
            <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">↝{row.source}</span>
          )}
        </span>
        <span className="tabular text-right text-[var(--paper)]">{fmtNum(row.last)}</span>
        <span className={cn("tabular text-right", signTone(row.dayChange))}>
          {fmtPct(row.dayChange)}
        </span>
        <span className="flex justify-end">
          {row.missing ? (
            <span className="text-[11px] text-[var(--brass)]">no data</span>
          ) : (
            <TrendChip trend={row.trend} />
          )}
        </span>
      </a>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${row.symbol}`}
        className="shrink-0 rounded p-1 text-[var(--muted)] opacity-0 transition hover:text-[var(--coral)] focus:opacity-100 group-hover:opacity-100"
      >
        <X size={13} />
      </button>
    </li>
  );
}

function ChartSection({
  row,
  prefs,
  height,
  onRemove,
  onRetarget,
  onClearSource,
}: {
  row: Row;
  prefs: MarketsPrefs;
  height: number;
  onRemove: () => void;
  onRetarget: (symbol: string, source: string) => Promise<string | null>;
  onClearSource: () => void;
}) {
  const redirected = row.source !== row.symbol;
  const listing = [row.meta?.exchangeName, row.meta?.currency].filter(Boolean).join(" · ");
  return (
    <section
      id={`chart-${row.symbol}`}
      aria-label={`${row.symbol} chart`}
      className="flex min-w-0 scroll-mt-4 flex-col gap-3"
    >
      <header
        className={cn(
          "flex min-h-[34px] flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2.5",
          row.missing ? "border-[var(--brass-dim)]" : "border-[var(--line-strong)]",
        )}
      >
        <h2 className="font-display text-lg tracking-tight">
          {row.symbol}
          {listing && (
            <span className="ml-2 font-sans text-xs font-normal tracking-normal text-[var(--muted)]">
              {listing}
            </span>
          )}
        </h2>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {redirected && (
            <button
              type="button"
              onClick={onClearSource}
              title={`Charted from ${row.source} — click to undo`}
              className="mono rounded-full border border-line px-2 py-0.5 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--coral)] hover:text-[var(--paper)]"
            >
              via {row.source} ×
            </button>
          )}
          {!row.missing && <TrendChip trend={row.trend} />}
          <span className="mono tabular">
            {fmtNum(row.last)}
            <span className={signTone(row.dayChange)}> {fmtPct(row.dayChange)}</span>
          </span>
        </span>
      </header>

      {row.missing ? (
        <SourceFinder row={row} height={height} onRetarget={onRetarget} onRemove={onRemove} />
      ) : (
        <div className="border-b border-line">
          <CandleChart
            bars={row.bars}
            points={row.points}
            showBand={prefs.showBand}
            colorCandles={prefs.colorCandles}
            showVolume={prefs.showVolume}
            interval={prefs.interval}
            height={height}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs text-[var(--muted)]">
        <span>{row.missing ? "No bars under this source." : trendSentence(row.trend)}</span>
        <span className="flex items-center gap-3.5">
          <Link
            href={`/investments/options/chain?ticker=${encodeURIComponent(row.symbol)}`}
            className="flex items-center gap-0.5 transition-colors hover:text-[var(--paper)]"
          >
            Chain <ArrowUpRight size={11} />
          </Link>
          <Link
            href={`/fundamentals?ticker=${encodeURIComponent(row.symbol)}`}
            className="flex items-center gap-0.5 transition-colors hover:text-[var(--paper)]"
          >
            Financials <ArrowUpRight size={11} />
          </Link>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${row.symbol}`}
            className="flex items-center gap-0.5 transition-colors hover:text-[var(--coral)]"
          >
            Remove <X size={11} />
          </button>
        </span>
      </div>
    </section>
  );
}

/** "AAPL · NasdaqGS · Equity" — one candidate, in one line. */
function SymbolMatchLabel({ match }: { match: SymbolMatch }) {
  return (
    <>
      <span className="mono text-xs text-[var(--paper)]">{match.symbol}</span>
      {match.name && (
        <span className="ml-1.5 text-[11px] text-[var(--muted)]">{match.name}</span>
      )}
      {(match.exchange || match.type) && (
        <span className="ml-1.5 text-[11px] text-[var(--muted)]">
          {[match.exchange, match.type].filter(Boolean).join(" · ")}
        </span>
      )}
    </>
  );
}

/**
 * What a chart card shows instead of an empty chart: the reason there's nothing
 * to draw, and a search for the symbol the market actually trades under.
 *
 * This is the whole point of storing a source separately from a ticker. A
 * position's symbol comes from a broker or a wallet and isn't negotiable — but
 * the symbol its *data* comes from is, and the user is the only one who can say
 * which listing is the right one. Rather than fail silently, ask.
 *
 * The search runs on open, seeded with the symbol itself, because that's the
 * query the user would have typed anyway.
 */
function SourceFinder({
  row,
  height,
  onRetarget,
  onRemove,
}: {
  row: Row;
  height: number;
  onRetarget: (symbol: string, source: string) => Promise<string | null>;
  onRemove: () => void;
}) {
  const [query, setQuery] = useState(row.symbol);
  const [matches, setMatches] = useState<SymbolMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setMatches(await searchMarketSymbols(q));
    } catch {
      setError("Symbol search is unreachable right now.");
      setMatches([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Seeded once per symbol; retyping re-searches through the form.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (seeded.current === row.symbol) return;
    seeded.current = row.symbol;
    void search(row.symbol);
  }, [row.symbol, search]);

  const apply = (source: string) => {
    setApplying(source);
    setError(null);
    void (async () => {
      const err = await onRetarget(row.symbol, source);
      setApplying(null);
      if (err) setError(err);
    })();
  };

  // Yahoo happily returns the failing symbol itself in its own search results;
  // offering it as the fix would be a no-op the user can't distinguish.
  const candidates = (matches ?? []).filter((m) => m.symbol !== row.source);

  return (
    <div className="flex flex-col gap-3 overflow-y-auto border-b border-line pb-4" style={{ height }}>
      <div>
        <p className="text-sm text-[var(--paper)]">
          Couldn&apos;t find market data for{" "}
          <span className="mono">{row.source}</span>.
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {row.held
            ? "This position is in your portfolio, but its ticker doesn't chart. Search for the listing it trades under."
            : "Search for the listing this trades under, or remove it from the desk."}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Symbol or company name"
          aria-label={`Find a data source for ${row.symbol}`}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--panel)] px-3 py-2 mono text-xs text-[var(--paper)] outline-none placeholder:font-sans placeholder:text-[var(--muted)] focus:border-[var(--brass-dim)]"
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          aria-label="Search"
          className="rounded-lg border border-line p-1.5 text-[var(--muted)] transition hover:border-[var(--brass-dim)] hover:text-[var(--paper)] disabled:opacity-40"
        >
          <Search size={14} className={searching ? "animate-pulse" : undefined} />
        </button>
      </form>

      {error && <p className="text-[11px] text-[var(--coral)]">{error}</p>}

      <ul className="flex flex-col">
        {candidates.map((m) => (
          <li key={m.symbol}>
            <button
              type="button"
              disabled={applying != null}
              onClick={() => apply(m.symbol)}
              className="w-full border-b border-line py-2 text-left transition-colors hover:bg-[var(--panel)] disabled:opacity-50"
            >
              <SymbolMatchLabel match={m} />
              {applying === m.symbol && (
                <span className="ml-1.5 text-[11px] text-[var(--brass)]">checking…</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {matches != null && candidates.length === 0 && !searching && (
        <p className="text-xs text-[var(--muted)]">
          Nothing matched “{query}”. Try the company name, or the ticker with its exchange suffix
          (e.g. <span className="mono">BMW.DE</span>).
        </p>
      )}

      <button
        type="button"
        onClick={onRemove}
        className="mt-auto self-start text-[11px] text-[var(--muted)] underline-offset-2 transition hover:text-[var(--coral)] hover:underline"
      >
        Remove {row.symbol} from the desk
      </button>
    </div>
  );
}

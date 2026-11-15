"use client";

import { useMemo, useState } from "react";
import type { SectorSlice } from "@/components/charts";
import { Mark, Verdict } from "@/components/ui/statement";
import { detectConcentration } from "@/lib/allocation";
import { parseOccSymbol } from "@/lib/options";
import { Bar, HeroLine, SideFigure } from "@/components/portfolio/ruled";
import { allocationVerdict } from "@/lib/investments-verdict";
import { formatCurrency } from "@/lib/utils";
import { AssetAllocation, type AllocRow } from "@/components/portfolio/asset-allocation";
import { LivePricesProvider, useLivePrices } from "@/components/portfolio/live-prices";
import {
  effectiveValue,
  liveSymbols,
  sectorColorMap,
  UNASSIGNED,
  type HoldingRow,
} from "@/components/portfolio/valuation";

/**
 * The Allocation tab's live half: asset class, geography, sector and targets,
 * valued off the same live quotes as the Holdings tab. It used to sit in the
 * middle of the holdings page, where picking a sector filtered the table below;
 * on its own tab the pick just highlights the sector.
 */
export function AllocationView({
  holdings,
  knownSectors,
  allocationTargets,
  assetClassOverrides,
  geographyOverrides,
  beta,
  riskReturn,
}: {
  holdings: HoldingRow[];
  knownSectors: string[];
  /** User-set target allocation percentages, keyed by dimension (see targetKeyFor). */
  allocationTargets: Record<string, number>;
  /** Per-position asset-class overrides, keyed by sectorKey. */
  assetClassOverrides: Record<string, string>;
  /** Per-position geography overrides, keyed by sectorKey. */
  geographyOverrides: Record<string, string>;
  /** Portfolio β for the hero line — streamed in by the tab (it needs a year of bars). */
  beta?: React.ReactNode;
  /** The risk/return scatter, streamed in beside Sector exposure for the same reason. */
  riskReturn?: React.ReactNode;
}) {
  const symbols = useMemo(() => liveSymbols(holdings), [holdings]);
  return (
    <LivePricesProvider symbols={symbols}>
      <AllocationInner
        holdings={holdings}
        knownSectors={knownSectors}
        allocationTargets={allocationTargets}
        assetClassOverrides={assetClassOverrides}
        geographyOverrides={geographyOverrides}
        beta={beta}
        riskReturn={riskReturn}
      />
    </LivePricesProvider>
  );
}

function AllocationInner({
  holdings,
  knownSectors,
  allocationTargets,
  assetClassOverrides,
  geographyOverrides,
  beta,
  riskReturn,
}: {
  holdings: HoldingRow[];
  knownSectors: string[];
  allocationTargets: Record<string, number>;
  assetClassOverrides: Record<string, string>;
  geographyOverrides: Record<string, string>;
  beta?: React.ReactNode;
  riskReturn?: React.ReactNode;
}) {
  const { quotes } = useLivePrices();
  const [activeSector, setActiveSector] = useState<string | null>(null);

  const total = useMemo(
    () => holdings.reduce((s, h) => s + effectiveValue(h, quotes), 0),
    [holdings, quotes],
  );

  // Live-valued rows for the allocation / targets panel, recomputed each tick.
  const rows = useMemo<AllocRow[]>(
    () =>
      holdings.map((h) => ({
        id: h.id,
        ticker: h.ticker,
        securityType: h.securityType,
        securityName: h.securityName,
        sectorKey: h.sectorKey,
        sector: h.sector ?? null,
        value: effectiveValue(h, quotes),
      })),
    [holdings, quotes],
  );

  const slices = useMemo<SectorSlice[]>(() => {
    const color = sectorColorMap(holdings.map((h) => h.sector ?? null));
    const agg = new Map<string, { value: number; count: number }>();
    for (const r of rows) {
      const s = r.sector ?? UNASSIGNED;
      const cur = agg.get(s) ?? { value: 0, count: 0 };
      cur.value += r.value;
      cur.count += 1;
      agg.set(s, cur);
    }
    return Array.from(agg.entries())
      .map(([sector, { value, count }]) => ({
        sector,
        value,
        count,
        color: color[sector] ?? "#8b948c",
      }))
      .sort((a, b) => b.value - a.value);
  }, [holdings, rows]);

  const sectorOptions = useMemo(
    () =>
      Array.from(new Set([...knownSectors, ...slices.map((s) => s.sector)]))
        .filter((s) => s !== UNASSIGNED)
        .sort(),
    [knownSectors, slices],
  );

  const verdict = useMemo(
    () => allocationVerdict({ slices, total, unassigned: UNASSIGNED }),
    [slices, total],
  );

  // Positions ranked by share of the book, with lots and option legs of one
  // underlying combined — the same aggregation the concentration warning uses.
  const ranked = useMemo(
    () =>
      detectConcentration(
        rows.map((r) => {
          const tk = tickerOf(r.ticker);
          return {
            key: tk ?? r.securityName ?? r.id,
            label: tk ?? r.securityName ?? "—",
            value: r.value,
          };
        }),
        total,
        0,
      ),
    [rows, total],
  );

  // Which names sit in each sector, largest first, for the exposure list.
  const namesBySector = useMemo(() => {
    const bySector = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const name = tickerOf(r.ticker);
      if (!name) continue;
      const sector = r.sector ?? UNASSIGNED;
      const names = bySector.get(sector) ?? new Map<string, number>();
      names.set(name, (names.get(name) ?? 0) + r.value);
      bySector.set(sector, names);
    }
    const out: Record<string, string[]> = {};
    for (const [sector, names] of bySector) {
      out[sector] = [...names.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    }
    return out;
  }, [rows]);

  // AssetAllocation renders nothing for an empty book; so does this.
  if (rows.length === 0) return null;

  const top = ranked[0];
  const top5 = ranked.slice(0, 5).reduce((a, w) => a + w.pct, 0);
  const concentrated = top != null && top.pct >= CONCENTRATION_LINE;
  const namedSectors = slices.filter((s) => s.sector !== UNASSIGNED).length;

  return (
    <div className="space-y-9">
      {/* The tab's one figure is how much of the book rides on a single name;
          the sentence says whether that is past the line, then which sector
          leads. Both come from the same live-valued total as everything below. */}
      <HeroLine
        hero={
          <div className="flex min-w-0 flex-1 basis-[380px] flex-col gap-3.5">
            <p className="eyebrow">Top position</p>
            <p
              className={`display-1 font-display text-5xl tabular sm:text-6xl ${
                concentrated ? "text-[var(--coral)]" : "text-[var(--paper)]"
              }`}
            >
              {top ? `${top.pct.toFixed(0)}%` : "—"}
              {top && (
                <span className="text-xl tracking-normal text-[var(--muted)] sm:text-2xl">
                  {" "}
                  of book in {top.label}
                </span>
              )}
            </p>
            <Verdict>
              {concentrated
                ? `One name is past the ${CONCENTRATION_LINE}% line.`
                : `No single name is past the ${CONCENTRATION_LINE}% line.`}
              {verdict && (
                <>
                  {" "}
                  {verdict.lead} <Mark tone={verdict.tone}>{verdict.share}</Mark> {verdict.tail}
                </>
              )}
            </Verdict>
          </div>
        }
      >
        <SideFigure label="Book value" value={formatCurrency(total)} />
        {beta != null && <SideFigure label="Portfolio β" value={beta} />}
        <SideFigure label="Top 5" value={`${top5.toFixed(0)}% concentration`} />
        <SideFigure
          label="Positions"
          value={`${rows.length} · ${namedSectors} ${namedSectors === 1 ? "sector" : "sectors"}`}
        />
      </HeroLine>

      <div className="flex flex-wrap gap-x-12 gap-y-9">
        {riskReturn && <div className="min-w-0 flex-[3_1_460px]">{riskReturn}</div>}
        <section aria-label="Sector exposure" className="flex min-w-0 flex-[2_1_300px] flex-col">
          <div className="border-b border-[var(--line-strong)] pb-2.5">
            <h2 className="font-display text-lg tracking-tight">Sector exposure</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Share of book value by sector, from the sectors you tag.
            </p>
          </div>
          {slices.map((s) => {
            const share = total ? (s.value / total) * 100 : 0;
            const names = namesBySector[s.sector] ?? [];
            const on = activeSector === s.sector;
            return (
              <button
                key={s.sector}
                type="button"
                aria-pressed={on}
                onClick={() => setActiveSector(on ? null : s.sector)}
                className="flex flex-col gap-2 border-b border-line py-3.5 text-left"
              >
                <span className="flex justify-between gap-3">
                  <span className={`min-w-0 font-medium ${on ? "text-[var(--brass)]" : ""}`}>
                    {s.sector}{" "}
                    <span className="text-xs font-normal text-[var(--muted)]">
                      {names.slice(0, 4).join(" · ")}
                      {names.length > 4 && ` · +${names.length - 4}`}
                    </span>
                  </span>
                  <span className="mono shrink-0 text-[13px]">{share.toFixed(1)}%</span>
                </span>
                <Bar pct={share} tone={share >= 50 ? "coral" : "brass"} />
              </button>
            );
          })}
        </section>
      </div>

      <AssetAllocation
        rows={rows}
        total={total}
        targets={allocationTargets}
        assetClassOverrides={assetClassOverrides}
        geographyOverrides={geographyOverrides}
        knownSectors={sectorOptions}
        sectorSlices={slices}
        activeSector={activeSector}
        onSelectSector={setActiveSector}
      />
    </div>
  );
}

/** A single name past this share of the book is called out as concentrated. */
const CONCENTRATION_LINE = 25;

/** The display ticker for a position — the option underlying when it's an OCC leg. */
function tickerOf(ticker: string | null): string | null {
  if (!ticker) return null;
  return parseOccSymbol(ticker)?.underlying ?? ticker.toUpperCase();
}

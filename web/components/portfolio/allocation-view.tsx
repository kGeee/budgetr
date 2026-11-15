"use client";

import { useMemo, useState } from "react";
import type { SectorSlice } from "@/components/charts";
import { Hero, Mark } from "@/components/ui/statement";
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
}: {
  holdings: HoldingRow[];
  knownSectors: string[];
  /** User-set target allocation percentages, keyed by dimension (see targetKeyFor). */
  allocationTargets: Record<string, number>;
  /** Per-position asset-class overrides, keyed by sectorKey. */
  assetClassOverrides: Record<string, string>;
  /** Per-position geography overrides, keyed by sectorKey. */
  geographyOverrides: Record<string, string>;
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
}: {
  holdings: HoldingRow[];
  knownSectors: string[];
  allocationTargets: Record<string, number>;
  assetClassOverrides: Record<string, string>;
  geographyOverrides: Record<string, string>;
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

  // AssetAllocation renders nothing for an empty book; so does this.
  if (rows.length === 0) return null;

  return (
    <div className="space-y-7">
      {/* The tab's one figure is the book the slices below divide up — the same
          live-valued total the panel takes its percentages from. */}
      <Hero
        eyebrow={`Allocated · ${rows.length} ${rows.length === 1 ? "position" : "positions"}`}
        figure={formatCurrency(total)}
        verdict={
          verdict && (
            <>
              {verdict.lead} <Mark tone={verdict.tone}>{verdict.share}</Mark> {verdict.tail}
            </>
          )
        }
      />
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

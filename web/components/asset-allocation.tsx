"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Pencil, Plus, Tag, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  AllocationDonut,
  PIE_COLORS,
  SectorBarChart,
  type SectorSlice,
} from "@/components/charts";
import { formatCurrency } from "@/lib/utils";
import { parseOccSymbol } from "@/lib/options";
import {
  ASSET_CLASSES,
  ASSET_CLASS_COLORS,
  ASSET_CLASS_LABELS,
  UNCLASSIFIED_REGION,
  assetClassFor,
  buildAllocation,
  computeDrift,
  detectConcentration,
  labelForTargetKey,
  parseTargetKey,
  targetKeyFor,
  type AllocHolding,
  type AssetClass,
  type TargetDimension,
} from "@/lib/allocation";
import {
  clearAllocationTarget,
  setAllocationTarget,
  setAssetClass,
  setGeography,
} from "@/lib/actions";

/** One live-valued position, the input to the whole allocation view. */
export type AllocRow = AllocHolding & {
  id: string;
  securityName: string | null;
  /** Currently assigned sector (drives sector-target drift), or null. */
  sector: string | null;
  /** Effective current value (live-priced), recomputed by the parent each tick. */
  value: number;
};

/** Region suggestions offered in the geography editor's datalist. */
const DEFAULT_REGIONS = [
  "United States",
  "Europe",
  "Asia-Pacific",
  "Emerging Markets",
  "Canada",
  "Japan",
  "Global",
  "Other",
];

/** The display ticker for a row — the option underlying when it's an OCC leg. */
function tickerKey(r: AllocRow): string | null {
  if (!r.ticker) return null;
  return parseOccSymbol(r.ticker)?.underlying ?? r.ticker.toUpperCase();
}

export function AssetAllocation({
  rows,
  total,
  targets,
  assetClassOverrides,
  geographyOverrides,
  knownSectors,
}: {
  rows: AllocRow[];
  total: number;
  targets: Record<string, number>;
  assetClassOverrides: Record<string, string>;
  geographyOverrides: Record<string, string>;
  knownSectors: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Optimistic overlays so an edit reflects instantly; the server action
  // persists in the background and router.refresh() reconciles the truth.
  const [targetEdits, setTargetEdits] = useState<Record<string, number | null>>({});
  const [classEdits, setClassEdits] = useState<Record<string, string | null>>({});
  const [geoEdits, setGeoEdits] = useState<Record<string, string | null>>({});

  const effTargets = useMemo(() => {
    const merged: Record<string, number> = { ...targets };
    for (const [k, v] of Object.entries(targetEdits)) {
      if (v == null) delete merged[k];
      else merged[k] = v;
    }
    return merged;
  }, [targets, targetEdits]);

  const classOf = (r: AllocRow): AssetClass => {
    const override =
      r.sectorKey in classEdits ? classEdits[r.sectorKey] : assetClassOverrides[r.sectorKey];
    return assetClassFor(r, override);
  };
  const regionOf = (r: AllocRow): string => {
    const override =
      r.sectorKey in geoEdits ? geoEdits[r.sectorKey] : geographyOverrides[r.sectorKey];
    return override?.trim() || UNCLASSIFIED_REGION;
  };

  function saveTarget(key: string, pct: number | null) {
    setTargetEdits((p) => ({ ...p, [key]: pct }));
    startTransition(async () => {
      if (pct == null) await clearAllocationTarget(key);
      else await setAllocationTarget(key, pct);
      router.refresh();
    });
  }
  function saveClass(sectorKey: string, cls: string | null) {
    setClassEdits((p) => ({ ...p, [sectorKey]: cls }));
    startTransition(async () => {
      await setAssetClass(sectorKey, cls ?? "");
      router.refresh();
    });
  }
  function saveGeography(sectorKey: string, region: string | null) {
    setGeoEdits((p) => ({ ...p, [sectorKey]: region }));
    startTransition(async () => {
      await setGeography(sectorKey, region ?? "");
      router.refresh();
    });
  }

  // ── Breakdowns ─────────────────────────────────────────────────────────────
  const assetChartData = useMemo<SectorSlice[]>(() => {
    const slices = buildAllocation(
      rows,
      (r) => {
        const cls = classOf(r);
        return { key: cls, label: ASSET_CLASS_LABELS[cls] };
      },
      (r) => r.value,
    );
    return slices.map((s) => ({
      sector: s.label,
      value: s.value,
      count: s.count,
      color: ASSET_CLASS_COLORS[s.key as AssetClass],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, classEdits, assetClassOverrides]);

  const geoChartData = useMemo<SectorSlice[]>(() => {
    const slices = buildAllocation(
      rows,
      (r) => {
        const region = regionOf(r);
        return { key: region, label: region };
      },
      (r) => r.value,
    );
    return slices.map((s, i) => ({
      sector: s.label,
      value: s.value,
      count: s.count,
      color:
        s.key === UNCLASSIFIED_REGION ? "#8b948c" : PIE_COLORS[i % PIE_COLORS.length],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, geoEdits, geographyOverrides]);

  const geoClassified = geoChartData.some((s) => s.sector !== UNCLASSIFIED_REGION);

  // Concentration: aggregate by ticker underlying (or name), flag ≥ 25%.
  const concentration = useMemo(
    () =>
      detectConcentration(
        rows.map((r) => {
          const tk = tickerKey(r);
          return {
            key: tk ?? r.securityName ?? r.id,
            label: tk ?? r.securityName ?? "—",
            value: r.value,
          };
        }),
        total,
        25,
      ),
    [rows, total],
  );

  // Live weight by target key, across all three dimensions, for the drift math.
  const currentByKey = useMemo(() => {
    const map: Record<string, { pct: number; value: number }> = {};
    const bump = (key: string, value: number) => {
      const cur = (map[key] ??= { pct: 0, value: 0 });
      cur.value += value;
    };
    for (const r of rows) {
      bump(targetKeyFor("class", classOf(r)), r.value);
      if (r.sector) bump(targetKeyFor("sector", r.sector), r.value);
      const tk = tickerKey(r);
      if (tk) bump(targetKeyFor("ticker", tk), r.value);
    }
    for (const v of Object.values(map)) v.pct = total ? (v.value / total) * 100 : 0;
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, total, classEdits, assetClassOverrides]);

  const driftByKey = useMemo(() => {
    const map: Record<string, ReturnType<typeof computeDrift>[number]> = {};
    for (const d of computeDrift(effTargets, currentByKey, total)) map[d.key] = d;
    return map;
  }, [effTargets, currentByKey, total]);

  // Drift rows: the five asset classes are always editable; any sector/ticker
  // target the user added is appended below.
  const driftRows = useMemo(() => {
    const classKeys = ASSET_CLASSES.map((c) => targetKeyFor("class", c));
    const extraKeys = Object.keys(effTargets).filter(
      (k) => parseTargetKey(k).dimension !== "class",
    );
    return [...classKeys, ...extraKeys].map((key) => {
      const cur = currentByKey[key] ?? { pct: 0, value: 0 };
      const d = driftByKey[key];
      return {
        key,
        label: labelForTargetKey(key),
        dimension: parseTargetKey(key).dimension,
        currentPct: cur.pct,
        currentValue: cur.value,
        targetPct: effTargets[key] ?? null,
        driftPct: d?.driftPct ?? null,
        deltaValue: d?.deltaValue ?? null,
      };
    });
  }, [effTargets, currentByKey, driftByKey]);

  const tickerOptions = useMemo(
    () =>
      Array.from(new Set(rows.map(tickerKey).filter((t): t is string => Boolean(t)))).sort(),
    [rows],
  );
  const regionOptions = useMemo(
    () =>
      Array.from(
        new Set([...DEFAULT_REGIONS, ...Object.values(geographyOverrides), ...Object.values(geoEdits).filter((v): v is string => Boolean(v))]),
      ).sort(),
    [geographyOverrides, geoEdits],
  );

  // One editor row per distinct position key (ticker/manual), for classification.
  const positions = useMemo(() => {
    const seen = new Map<string, AllocRow>();
    for (const r of rows) if (!seen.has(r.sectorKey)) seen.set(r.sectorKey, r);
    return Array.from(seen.values()).sort((a, b) => b.value - a.value);
  }, [rows]);

  const [showClassify, setShowClassify] = useState(false);

  if (rows.length === 0) return null;

  const assetTotal = assetChartData.reduce((s, d) => s + d.value, 0);
  const anyTargets = Object.keys(effTargets).length > 0;

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <span className="eyebrow">Asset allocation &amp; targets</span>
        <span className="text-xs text-[var(--faint)]">drift vs. your target mix</span>
      </div>

      {concentration.length > 0 && (
        <div className="space-y-2 border-b border-line px-6 py-4">
          {concentration.map((w) => (
            <div
              key={w.key}
              className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--coral)]/40 bg-[var(--coral)]/10 px-4 py-2.5 text-sm"
            >
              <AlertTriangle size={15} className="shrink-0 text-[var(--coral)]" />
              <span className="text-[var(--paper)]">
                <span className="mono font-medium text-[var(--coral)]">
                  {w.pct.toFixed(0)}%
                </span>{" "}
                of your portfolio is in{" "}
                <span className="font-medium">{w.label}</span> —{" "}
                <span className="text-[var(--muted)]">
                  {formatCurrency(w.value)}. Consider trimming to reduce single-position risk.
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-8 px-6 py-6 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="eyebrow mb-3">By asset class</p>
          <AllocationDonut data={assetChartData} total={assetTotal} />
          <ul className="mt-4 space-y-1.5 text-sm">
            {assetChartData.map((d) => (
              <li key={d.sector} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5 text-[var(--muted)]">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: d.color }}
                  />
                  <span className="truncate">{d.sector}</span>
                </span>
                <span className="mono shrink-0 text-[var(--muted)]">
                  {assetTotal ? ((d.value / assetTotal) * 100).toFixed(1) : "0.0"}%
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          <p className="eyebrow mb-3">By geography</p>
          {geoClassified ? (
            <SectorBarChart data={geoChartData.filter((d) => d.sector !== UNCLASSIFIED_REGION)} />
          ) : (
            <div className="flex h-[180px] flex-col items-center justify-center gap-1 text-center">
              <p className="font-display text-base text-[var(--paper)]">No geography yet</p>
              <p className="text-sm text-[var(--muted)]">
                Assign a region below to chart your geographic exposure.
              </p>
            </div>
          )}
          {geoClassified && (
            <p className="mt-3 text-xs text-[var(--faint)]">
              {geoChartData.find((d) => d.sector === UNCLASSIFIED_REGION)
                ? `${formatCurrency(
                    geoChartData.find((d) => d.sector === UNCLASSIFIED_REGION)!.value,
                  )} still unclassified.`
                : "Every position has a region."}
            </p>
          )}
        </div>
      </div>

      {/* ── Targets & drift ─────────────────────────────────────────────── */}
      <div className="border-t border-line">
        <div className="flex items-center justify-between px-6 py-3">
          <span className="eyebrow">Target vs. actual</span>
          {!anyTargets && (
            <span className="text-xs text-[var(--faint)]">
              Set targets to see rebalancing hints
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {["Allocation", "Actual", "Target", "Drift", "Rebalance"].map((h, i) => (
                  <th
                    key={h}
                    className={`px-6 py-2.5 eyebrow font-medium ${i >= 1 ? "text-right" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {driftRows.map(({ key, ...row }) => (
                <DriftTableRow
                  key={key}
                  {...row}
                  onSetTarget={(pct) => saveTarget(key, pct)}
                  onClear={() => saveTarget(key, null)}
                />
              ))}
            </tbody>
          </table>
        </div>
        <AddTargetRow
          sectorOptions={knownSectors}
          tickerOptions={tickerOptions}
          onAdd={(dimension, name, pct) => saveTarget(targetKeyFor(dimension, name), pct)}
        />
      </div>

      {/* ── Classify positions ──────────────────────────────────────────── */}
      <div className="border-t border-line">
        <button
          onClick={() => setShowClassify((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-3 text-left transition hover:bg-[var(--panel-2)]"
        >
          <span className="eyebrow">Classify positions</span>
          <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
            asset class &amp; region overrides
            <ChevronDown
              size={14}
              className={`transition-transform ${showClassify ? "rotate-180" : ""}`}
            />
          </span>
        </button>
        {showClassify && (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Position", "Value", "Asset class", "Region"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-6 py-2.5 eyebrow font-medium ${i === 1 ? "text-right" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((r) => {
                  const override =
                    r.sectorKey in classEdits
                      ? classEdits[r.sectorKey]
                      : assetClassOverrides[r.sectorKey];
                  const region =
                    r.sectorKey in geoEdits
                      ? geoEdits[r.sectorKey]
                      : geographyOverrides[r.sectorKey] ?? null;
                  return (
                    <tr
                      key={r.sectorKey}
                      className="border-b border-line/60 last:border-0"
                    >
                      <td className="px-6 py-2.5">
                        <span className="font-medium text-[var(--brass)]">
                          {tickerKey(r) ?? "—"}
                        </span>
                        <span className="ml-2 text-[var(--muted)]">{r.securityName}</span>
                      </td>
                      <td className="mono px-6 py-2.5 text-right text-[var(--muted)]">
                        {formatCurrency(r.value)}
                      </td>
                      <td className="px-6 py-2.5">
                        <ClassEditor
                          value={classOf(r)}
                          isOverridden={Boolean(override)}
                          onSave={(cls) => saveClass(r.sectorKey, cls)}
                        />
                      </td>
                      <td className="px-6 py-2.5">
                        <RegionEditor
                          region={region?.trim() || null}
                          options={regionOptions}
                          onSave={(reg) => saveGeography(r.sectorKey, reg)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

/** One drift row: actual %, an editable target %, the drift chip, and a $ hint. */
function DriftTableRow({
  label,
  dimension,
  currentPct,
  targetPct,
  driftPct,
  deltaValue,
  onSetTarget,
  onClear,
}: {
  label: string;
  dimension: TargetDimension;
  currentPct: number;
  currentValue: number;
  targetPct: number | null;
  driftPct: number | null;
  deltaValue: number | null;
  onSetTarget: (pct: number | null) => void;
  onClear: () => void;
}) {
  const overweight = (driftPct ?? 0) > 0;
  const inBand = driftPct != null && Math.abs(driftPct) < 1;
  return (
    <tr className="border-b border-line/60 last:border-0">
      <td className="px-6 py-2.5">
        <span className="inline-flex items-center gap-2">
          <span className="text-[var(--paper)]">{label}</span>
          {dimension !== "class" && (
            <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--faint)]">
              {dimension}
            </span>
          )}
        </span>
      </td>
      <td className="mono px-6 py-2.5 text-right text-[var(--muted)]">
        {currentPct.toFixed(1)}%
      </td>
      <td className="px-6 py-2.5 text-right">
        <PercentEditor value={targetPct} onSave={onSetTarget} onClear={onClear} />
      </td>
      <td
        className={`mono px-6 py-2.5 text-right ${
          driftPct == null
            ? "text-[var(--faint)]"
            : inBand
              ? "text-[var(--muted)]"
              : overweight
                ? "text-[var(--coral)]"
                : "text-[var(--brass)]"
        }`}
      >
        {driftPct == null
          ? "—"
          : `${driftPct >= 0 ? "+" : "−"}${Math.abs(driftPct).toFixed(1)} pts`}
      </td>
      <td
        className={`mono px-6 py-2.5 text-right ${
          deltaValue == null || inBand
            ? "text-[var(--faint)]"
            : deltaValue >= 0
              ? "text-[var(--jade)]"
              : "text-[var(--coral)]"
        }`}
      >
        {deltaValue == null || inBand
          ? "—"
          : `${deltaValue >= 0 ? "Buy " : "Trim "}${formatCurrency(Math.abs(deltaValue))}`}
      </td>
    </tr>
  );
}

/** Click-to-edit target percent. Empty/0 clears the target. */
function PercentEditor({
  value,
  onSave,
  onClear,
}: {
  value: number | null;
  onSave: (pct: number | null) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(value != null ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const skip = useRef(false);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function commit() {
    setOpen(false);
    if (skip.current) {
      skip.current = false;
      return;
    }
    const trimmed = val.trim();
    if (trimmed === "") {
      if (value != null) onClear();
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      if (value != null) onClear();
      return;
    }
    if (n !== value) onSave(Math.min(100, n));
  }

  if (open) {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        <input
          ref={inputRef}
          value={val}
          inputMode="decimal"
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") inputRef.current?.blur();
            else if (e.key === "Escape") {
              skip.current = true;
              inputRef.current?.blur();
            }
          }}
          placeholder="—"
          className="w-16 rounded-md border border-line bg-[var(--panel-2)] px-2 py-0.5 text-right text-xs text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
        />
        <span className="text-xs text-[var(--faint)]">%</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setVal(value != null ? String(value) : "");
        setOpen(true);
      }}
      className={`group/pct mono inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition ${
        value != null
          ? "border-line text-[var(--paper)] hover:border-[var(--brass-dim)]"
          : "border-dashed border-line text-[var(--faint)] hover:text-[var(--muted)]"
      }`}
    >
      {value != null ? `${value}%` : "set"}
      <Pencil size={9} className="opacity-0 transition group-hover/pct:opacity-60" />
    </button>
  );
}

/** Inline asset-class picker (datalist of the five classes). Empty reverts to auto. */
function ClassEditor({
  value,
  isOverridden,
  onSave,
}: {
  value: AssetClass;
  isOverridden: boolean;
  onSave: (cls: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const skip = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function commit() {
    setOpen(false);
    if (skip.current) {
      skip.current = false;
      return;
    }
    const next = val.trim().toLowerCase();
    if (!next) {
      if (isOverridden) onSave(null);
      return;
    }
    if ((ASSET_CLASSES as string[]).includes(next) && (next !== value || !isOverridden)) {
      onSave(next);
    }
  }

  if (open) {
    return (
      <span className="inline-flex items-center">
        <input
          ref={inputRef}
          list={listId}
          value={val}
          onChange={(e) => setVal(e.target.value as AssetClass)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") inputRef.current?.blur();
            else if (e.key === "Escape") {
              skip.current = true;
              inputRef.current?.blur();
            }
          }}
          className="w-28 rounded-md border border-line bg-[var(--panel-2)] px-2 py-0.5 text-xs text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
        />
        <datalist id={listId}>
          {ASSET_CLASSES.map((c) => (
            <option key={c} value={c}>
              {ASSET_CLASS_LABELS[c]}
            </option>
          ))}
        </datalist>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setVal(value);
        setOpen(true);
      }}
      className="group/cls inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-[var(--muted)] transition hover:text-[var(--paper)]"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-sm"
        style={{ background: ASSET_CLASS_COLORS[value] }}
      />
      {ASSET_CLASS_LABELS[value]}
      {!isOverridden && <span className="text-[10px] text-[var(--faint)]">auto</span>}
      <Pencil size={9} className="opacity-0 transition group-hover/cls:opacity-60" />
    </button>
  );
}

/** Inline region editor (datalist of common regions). Empty clears the region. */
function RegionEditor({
  region,
  options,
  onSave,
}: {
  region: string | null;
  options: string[];
  onSave: (region: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(region ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const skip = useRef(false);
  const listId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function commit() {
    setOpen(false);
    if (skip.current) {
      skip.current = false;
      return;
    }
    const next = val.trim() || null;
    if (next !== (region ?? null)) onSave(next);
  }

  if (open) {
    return (
      <span className="inline-flex items-center">
        <input
          ref={inputRef}
          list={listId}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") inputRef.current?.blur();
            else if (e.key === "Escape") {
              skip.current = true;
              inputRef.current?.blur();
            }
          }}
          placeholder="Region…"
          className="w-36 rounded-md border border-line bg-[var(--panel-2)] px-2 py-0.5 text-xs text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
        />
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      </span>
    );
  }

  if (region) {
    return (
      <button
        type="button"
        onClick={() => {
          setVal(region);
          setOpen(true);
        }}
        className="group/reg inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-[var(--muted)] transition hover:text-[var(--paper)]"
      >
        {region}
        <Pencil size={9} className="opacity-0 transition group-hover/reg:opacity-60" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setVal("");
        setOpen(true);
      }}
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-[var(--faint)] transition hover:text-[var(--muted)]"
    >
      <Tag size={9} /> region
    </button>
  );
}

/** Footer control to add a sector- or ticker-scoped target to the drift table. */
function AddTargetRow({
  sectorOptions,
  tickerOptions,
  onAdd,
}: {
  sectorOptions: string[];
  tickerOptions: string[];
  onAdd: (dimension: TargetDimension, name: string, pct: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dimension, setDimension] = useState<TargetDimension>("sector");
  const [name, setName] = useState("");
  const [pct, setPct] = useState("");
  const listId = useId();

  function submit() {
    const n = name.trim();
    const p = Number(pct);
    if (!n || !Number.isFinite(p) || p <= 0) return;
    onAdd(dimension, n, Math.min(100, p));
    setName("");
    setPct("");
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="border-t border-line px-6 py-3">
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-[var(--muted)] transition hover:text-[var(--paper)]"
        >
          <Plus size={12} /> Add sector / ticker target
        </button>
      </div>
    );
  }

  const options = dimension === "sector" ? sectorOptions : tickerOptions;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3">
      <div className="inline-flex overflow-hidden rounded-md border border-line text-xs">
        {(["sector", "ticker"] as const).map((d) => (
          <button
            key={d}
            onClick={() => {
              setDimension(d);
              setName("");
            }}
            className={`px-2.5 py-1 capitalize transition ${
              dimension === d
                ? "bg-[var(--brass-dim)] text-[var(--ink)]"
                : "text-[var(--muted)] hover:text-[var(--paper)]"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <input
        list={listId}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={dimension === "sector" ? "Sector…" : "Ticker…"}
        className="w-40 rounded-md border border-line bg-[var(--panel-2)] px-2 py-1 text-xs text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <span className="inline-flex items-center gap-1">
        <input
          value={pct}
          inputMode="decimal"
          onChange={(e) => setPct(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="%"
          className="w-16 rounded-md border border-line bg-[var(--panel-2)] px-2 py-1 text-right text-xs text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
        />
        <span className="text-xs text-[var(--faint)]">%</span>
      </span>
      <button
        onClick={submit}
        className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-[var(--jade)] transition hover:border-[var(--jade)]"
      >
        <Check size={12} /> Add
      </button>
      <button
        onClick={() => setOpen(false)}
        aria-label="Cancel"
        className="rounded-md p-1 text-[var(--faint)] transition hover:text-[var(--paper)]"
      >
        <X size={14} />
      </button>
    </div>
  );
}

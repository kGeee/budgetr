"use client";

import { HULL_MODES, HULL_SOURCES, type MarketsPrefs } from "@/lib/markets-prefs";
import type { HullMode, HullSource } from "@/lib/hull";

/**
 * The Hull Suite's inputs, one control per Pine `input()` in the study.
 *
 * Deliberately the only indicator panel on the desk: the point of this screen is
 * one consistent read across every symbol, and a stack of optional overlays is
 * how that turns back into noise. The two Pine inputs missing here are
 * `useHtf`/`htf` — resampling the study from a higher timeframe is the same
 * thing as picking a bigger timeframe in the toolbar, so it would be a second
 * control for one behaviour — and `thicknesSwitch`/`transpSwitch`, which are
 * cosmetics the chart fixes at legible values.
 */

const LENGTH_PRESETS: { value: number; hint: string }[] = [
  { value: 55, hint: "swing entry" },
  { value: 180, hint: "floating S/R" },
  { value: 200, hint: "floating S/R" },
];

const SOURCE_LABEL: Record<HullSource, string> = {
  close: "Close",
  open: "Open",
  high: "High",
  low: "Low",
  hl2: "HL2",
  hlc3: "HLC3",
  ohlc4: "OHLC4",
};

export function HullSettingsPanel({
  prefs,
  onChange,
}: {
  prefs: MarketsPrefs;
  onChange: (next: MarketsPrefs) => void;
}) {
  const setHull = (patch: Partial<MarketsPrefs["hull"]>) =>
    onChange({ ...prefs, hull: { ...prefs.hull, ...patch } });

  return (
    <div className="grid gap-5 rounded-[var(--radius)] border border-line bg-[var(--panel)] p-5 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Hull variation" hint="Pine: modeSwitch">
        <div className="flex rounded-full border border-line bg-[var(--ink)] p-0.5">
          {HULL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setHull({ mode: m as HullMode })}
              aria-pressed={prefs.hull.mode === m}
              className={`flex-1 rounded-full px-2.5 py-1 text-xs transition ${
                prefs.hull.mode === m
                  ? "bg-[var(--panel-2)] text-[var(--paper)]"
                  : "text-[var(--muted)] hover:text-[var(--paper)]"
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Length" hint="55 swing · 180–200 floating S/R">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={2}
            max={400}
            value={prefs.hull.length}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setHull({ length: Math.min(400, Math.max(2, Math.round(n))) });
            }}
            className="w-20 rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1 font-mono text-xs text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
          />
          <div className="flex gap-1">
            {LENGTH_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                title={p.hint}
                onClick={() => setHull({ length: p.value })}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition ${
                  prefs.hull.length === p.value
                    ? "border-[var(--brass-dim)] text-[var(--paper)]"
                    : "border-line text-[var(--muted)] hover:text-[var(--paper)]"
                }`}
              >
                {p.value}
              </button>
            ))}
          </div>
        </div>
      </Field>

      <Field label="Length multiplier" hint="Straighter band, same timeframe">
        <input
          type="range"
          min={0.5}
          max={4}
          step={0.1}
          value={prefs.hull.lengthMult}
          onChange={(e) => setHull({ lengthMult: Number(e.target.value) })}
          className="w-full accent-[var(--brass)]"
        />
        <span className="font-mono text-[10px] text-[var(--muted)]">
          ×{prefs.hull.lengthMult.toFixed(1)} → effective{" "}
          {Math.trunc(prefs.hull.length * prefs.hull.lengthMult)}
        </span>
      </Field>

      <Field label="Source" hint="Pine: src">
        <select
          value={prefs.hull.source}
          onChange={(e) => setHull({ source: e.target.value as HullSource })}
          className="w-full rounded-lg border border-line bg-[var(--ink)] px-2.5 py-1.5 text-xs text-[var(--paper)] outline-none focus:border-[var(--brass-dim)]"
        >
          {HULL_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s as HullSource]}
            </option>
          ))}
        </select>
      </Field>

      <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4">
        <Check
          label="Show as a band"
          hint="Plots SHULL (HULL[2]) and fills to MHULL"
          checked={prefs.showBand}
          onChange={(v) => onChange({ ...prefs, showBand: v })}
        />
        <Check
          label="Color candles by trend"
          hint="Pine: barcolor()"
          checked={prefs.colorCandles}
          onChange={(v) => onChange({ ...prefs, colorCandles: v })}
        />
        <Check
          label="Volume"
          checked={prefs.showVolume}
          onChange={(v) => onChange({ ...prefs, showVolume: v })}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-[var(--faint)]">{hint}</span>}
    </label>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]" title={hint}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--brass)]"
      />
      <span className={checked ? "text-[var(--paper)]" : undefined}>{label}</span>
    </label>
  );
}

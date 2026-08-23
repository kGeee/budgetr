"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChartTheme } from "@/lib/chart-theme";
import type { Bar, HullPoint } from "@/lib/hull";
import type { BarInterval } from "@/lib/yahoo";

/**
 * A candlestick chart with the Hull Suite band drawn over it, on a raw canvas.
 *
 * Why not recharts, which the rest of the app uses: recharts has no candlestick
 * primitive (every "solution" is a custom `<Bar shape>` hack that fights the
 * axis scales), no crosshair worth the name, and no viewport — and this desk
 * needs pan/zoom over a few thousand bars across up to nine simultaneous
 * charts. That is a canvas job. `components/iv-surface.tsx` set the precedent.
 *
 * The Hull study is drawn exactly as the Pine plots it: MHULL and SHULL as two
 * lines of the same color, the region between them filled, the color switching
 * green/red on `HULL > HULL[2]`. See lib/hull.ts for the math.
 */

type Props = {
  bars: Bar[];
  /**
   * The Hull study, aligned bar-for-bar with `bars`. Passed in rather than
   * computed here so the chart and the watchlist's trend column are literally
   * the same array and cannot drift apart.
   */
  points: HullPoint[];
  /** Pine's `visualSwitch` — false plots only the leading MHULL line. */
  showBand?: boolean;
  /** Pine's `candleCol` — tint the candles with the Hull's trend color. */
  colorCandles?: boolean;
  showVolume?: boolean;
  /** Labels the time axis appropriately (intraday clock vs. calendar dates). */
  interval?: BarInterval;
  height?: number;
};

// Chart furniture, in CSS pixels.
const PAD = { top: 10, right: 58, bottom: 20, left: 6 };
/** Share of the plot area given to the volume histogram when it's shown. */
const VOL_SHARE = 0.16;
/** Pine's band filler is `transp=40`; that reads as mud over candles on a dark
 *  panel, so the fill is lighter here while the lines stay at full strength. */
const BAND_ALPHA = 0.16;

/** Parse a `#rgb`/`#rrggbb` token into components, or null for anything else. */
function rgbOf(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function withAlpha(color: string, alpha: number): string {
  const rgb = rgbOf(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

/**
 * Readable text over a filled chip. The jade/coral tokens differ between light
 * and dark themes, so this reads the actual color rather than branching on which
 * theme is active — a palette change can't silently make the label unreadable.
 */
function contrastOn(color: string): string {
  const rgb = rgbOf(color);
  if (!rgb) return "#000";
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#0b0f0e" : "#fbf9f3";
}

/** Decimals appropriate to the magnitude being shown (a $0.30 penny vs BTC). */
function priceDecimals(span: number, level: number): number {
  const ref = Math.max(Math.abs(level), span);
  if (ref >= 1000) return 2;
  if (ref >= 10) return 2;
  if (ref >= 1) return 3;
  if (ref >= 0.01) return 4;
  return 6;
}

function fmtPrice(v: number, decimals: number): string {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${v}`;
}

const isIntraday = (iv: BarInterval) => iv.endsWith("m") || iv === "1h";

function fmtTime(t: number, interval: BarInterval): string {
  const d = new Date(t);
  if (isIntraday(interval)) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (interval === "1mo") return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtFullTime(t: number, interval: BarInterval): string {
  const d = new Date(t);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return isIntraday(interval)
    ? `${date} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : date;
}

/** "Nice" axis steps — 1, 2, 2.5, 5 × a power of ten. */
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * pow;
}

/** How many bars fit before candles stop being distinguishable. */
const MIN_VISIBLE = 20;
const DEFAULT_VISIBLE = 160;

type Hover = { i: number; x: number; y: number } | null;

export function CandleChart({
  bars,
  points,
  showBand = true,
  colorCandles = false,
  showVolume = true,
  interval = "1d",
  height = 380,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const theme = useChartTheme();

  const [size, setSize] = useState({ w: 0, h: height });
  const [hover, setHover] = useState<Hover>(null);

  // Viewport: `count` bars ending at index `end` (exclusive). Kept in state so
  // pan/zoom survives re-render, and reset whenever the series identity changes.
  const [view, setView] = useState({ end: bars.length, count: Math.min(bars.length, DEFAULT_VISIBLE) });
  const seriesKey = `${bars.length}:${bars[0]?.t ?? 0}:${bars[bars.length - 1]?.t ?? 0}`;
  const [seenKey, setSeenKey] = useState(seriesKey);
  if (seenKey !== seriesKey) {
    // Adjust state during render rather than in an effect: a new symbol or
    // timeframe should land on the most recent bars, and going through an effect
    // would paint one frame with the old viewport against the new series.
    setSeenKey(seriesKey);
    setView({ end: bars.length, count: Math.min(bars.length, DEFAULT_VISIBLE) });
  }

  // ── layout ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: height });
    return () => ro.disconnect();
  }, [height]);

  // An empty series collapses to an empty window. The component early-returns a
  // placeholder below, but hooks run first, so every derived value here has to
  // survive `bars` being [] — which it is for a delisted or misspelled symbol.
  const end = bars.length === 0 ? 0 : Math.max(1, Math.min(view.end, bars.length));
  const start = bars.length === 0 ? 0 : Math.max(0, Math.min(view.end - view.count, end - 1));
  const visible = bars.slice(start, end);

  const geom = useMemo(() => {
    const plotW = Math.max(0, size.w - PAD.left - PAD.right);
    const plotH = Math.max(0, size.h - PAD.top - PAD.bottom);
    const volH = showVolume ? plotH * VOL_SHARE : 0;
    const priceH = plotH - volH;
    const barW = visible.length ? plotW / visible.length : 0;
    return { plotW, plotH, volH, priceH, barW };
  }, [size.w, size.h, showVolume, visible.length]);

  // Price extent covers both the candles and the Hull band, so the study never
  // runs off the top or bottom of its own chart.
  const scale = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i++) {
      const b = bars[i];
      if (b.low < lo) lo = b.low;
      if (b.high > hi) hi = b.high;
      const p = points[i];
      for (const v of [p?.mhull, showBand ? p?.shull : null]) {
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1, span: 1 };
    if (hi === lo) {
      hi += Math.abs(hi) * 0.01 || 1;
      lo -= Math.abs(lo) * 0.01 || 1;
    }
    const pad = (hi - lo) * 0.06;
    return { lo: lo - pad, hi: hi + pad, span: hi - lo + 2 * pad };
  }, [bars, points, start, end, showBand]);

  const maxVol = useMemo(() => {
    let m = 0;
    for (let i = start; i < end; i++) m = Math.max(m, bars[i].volume ?? 0);
    return m;
  }, [bars, start, end]);

  const xOf = useCallback((i: number) => PAD.left + (i - start + 0.5) * geom.barW, [start, geom.barW]);
  const yOf = useCallback(
    (p: number) => PAD.top + ((scale.hi - p) / scale.span) * geom.priceH,
    [scale, geom.priceH],
  );

  // ── draw ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || visible.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = `10px var(--font-mono), ui-monospace, monospace`;
    ctx.textBaseline = "middle";

    const priceBottom = PAD.top + geom.priceH;
    const decimals = priceDecimals(scale.span, (scale.hi + scale.lo) / 2);

    // ── grid + price axis ───────────────────────────────────────────────────
    const step = niceStep(scale.span / 5);
    const first = Math.ceil(scale.lo / step) * step;
    ctx.strokeStyle = theme.grid;
    ctx.fillStyle = theme.muted;
    ctx.lineWidth = 1;
    ctx.textAlign = "left";
    for (let p = first; p <= scale.hi; p += step) {
      const y = Math.round(yOf(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + geom.plotW, y);
      ctx.stroke();
      ctx.fillText(fmtPrice(p, decimals), PAD.left + geom.plotW + 6, y);
    }

    // ── time axis ───────────────────────────────────────────────────────────
    const targetTicks = Math.max(2, Math.floor(geom.plotW / 90));
    const tickEvery = Math.max(1, Math.ceil(visible.length / targetTicks));
    ctx.textAlign = "center";
    ctx.strokeStyle = theme.grid;
    for (let i = start; i < end; i++) {
      if ((i - start) % tickEvery !== 0) continue;
      const x = Math.round(xOf(i)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, priceBottom + geom.volH);
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.fillText(fmtTime(bars[i].t, interval), x, size.h - PAD.bottom / 2);
    }

    // ── volume ──────────────────────────────────────────────────────────────
    if (showVolume && maxVol > 0) {
      const volTop = priceBottom + 4;
      const volH = Math.max(0, geom.volH - 4);
      const bw = Math.max(1, geom.barW * 0.7);
      for (let i = start; i < end; i++) {
        const b = bars[i];
        if (!b.volume) continue;
        const h = (b.volume / maxVol) * volH;
        ctx.fillStyle = withAlpha(b.close >= b.open ? theme.jade : theme.coral, 0.3);
        ctx.fillRect(xOf(i) - bw / 2, volTop + volH - h, bw, h);
      }
    }

    // ── Hull band ───────────────────────────────────────────────────────────
    // Drawn under the candles so price stays readable, and split into runs of a
    // single trend color so the green→red handoff lands on the exact flip bar.
    type Run = { from: number; to: number; up: boolean };
    const runs: Run[] = [];
    for (let i = start; i < end; i++) {
      const p = points[i];
      if (p?.mhull == null || p.up == null || (showBand && p.shull == null)) continue;
      const last = runs[runs.length - 1];
      if (last && last.to === i - 1 && last.up === p.up) last.to = i;
      else runs.push({ from: i, to: i, up: p.up });
    }

    // The fill: MHULL forward, SHULL back. One extra bar of overlap between runs
    // keeps the band from showing a hairline gap at each color change.
    if (showBand) {
      for (const run of runs) {
        const to = Math.min(run.to + 1, end - 1);
        if (to <= run.from) continue;
        ctx.beginPath();
        for (let i = run.from; i <= to; i++) ctx.lineTo(xOf(i), yOf(points[i].mhull!));
        for (let i = to; i >= run.from; i--) ctx.lineTo(xOf(i), yOf(points[i].shull!));
        ctx.closePath();
        ctx.fillStyle = withAlpha(run.up ? theme.jade : theme.coral, BAND_ALPHA);
        ctx.fill();
      }
    }

    const drawLine = (key: "mhull" | "shull", width: number) => {
      for (const run of runs) {
        const to = Math.min(run.to + 1, end - 1);
        ctx.beginPath();
        for (let i = run.from; i <= to; i++) {
          const v = points[i]?.[key];
          if (v == null) continue;
          ctx.lineTo(xOf(i), yOf(v));
        }
        ctx.strokeStyle = run.up ? theme.jade : theme.coral;
        ctx.lineWidth = width;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
    };
    if (showBand) drawLine("shull", 1.25);
    drawLine("mhull", 1.75);

    // ── candles ─────────────────────────────────────────────────────────────
    const bodyW = Math.max(1, Math.min(geom.barW * 0.7, 18));
    for (let i = start; i < end; i++) {
      const b = bars[i];
      const up = b.close >= b.open;
      // Pine's `barcolor()` override: candles take the Hull's trend color.
      const trendColor = points[i]?.up == null ? null : points[i].up ? theme.jade : theme.coral;
      const color = colorCandles && trendColor ? trendColor : up ? theme.jade : theme.coral;
      const x = xOf(i);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const wx = Math.round(x) + 0.5;
      ctx.moveTo(wx, yOf(b.high));
      ctx.lineTo(wx, yOf(b.low));
      ctx.stroke();

      const yOpen = yOf(b.open);
      const yClose = yOf(b.close);
      const top = Math.min(yOpen, yClose);
      const h = Math.max(1, Math.abs(yClose - yOpen));
      // Down candles are filled, up candles hollow — the standard reading, and
      // it keeps a green band from swallowing green bodies.
      if (up) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x - bodyW / 2) + 0.5, Math.round(top) + 0.5, Math.round(bodyW), Math.round(h));
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x - bodyW / 2, top, bodyW, h);
      }
    }

    // ── last price marker ───────────────────────────────────────────────────
    const lastBar = bars[end - 1];
    if (lastBar) {
      const y = yOf(lastBar.close);
      const up = points[end - 1]?.up;
      const color = up == null ? theme.brass : up ? theme.jade : theme.coral;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = withAlpha(color, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.left, Math.round(y) + 0.5);
      ctx.lineTo(PAD.left + geom.plotW, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      const label = fmtPrice(lastBar.close, decimals);
      const w = ctx.measureText(label).width + 8;
      ctx.fillStyle = color;
      ctx.fillRect(PAD.left + geom.plotW + 2, y - 8, Math.min(w, PAD.right - 4), 16);
      ctx.fillStyle = contrastOn(color);
      ctx.textAlign = "left";
      ctx.fillText(label, PAD.left + geom.plotW + 6, y);
    }

    // ── crosshair ───────────────────────────────────────────────────────────
    if (hover && hover.i >= start && hover.i < end) {
      const x = Math.round(xOf(hover.i)) + 0.5;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = theme.gridStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, priceBottom + geom.volH);
      ctx.stroke();
      if (hover.y > PAD.top && hover.y < priceBottom) {
        const hy = Math.round(hover.y) + 0.5;
        ctx.beginPath();
        ctx.moveTo(PAD.left, hy);
        ctx.lineTo(PAD.left + geom.plotW, hy);
        ctx.stroke();
        const p = scale.hi - ((hover.y - PAD.top) / geom.priceH) * scale.span;
        const label = fmtPrice(p, decimals);
        ctx.setLineDash([]);
        ctx.fillStyle = theme.gridStrong;
        ctx.fillRect(PAD.left + geom.plotW + 2, hover.y - 8, PAD.right - 4, 16);
        ctx.fillStyle = theme.paper;
        ctx.textAlign = "left";
        ctx.fillText(label, PAD.left + geom.plotW + 6, hover.y);
      }
      ctx.setLineDash([]);
    }
  }, [
    bars, points, start, end, visible.length, size, geom, scale, theme, hover,
    showBand, colorCandles, showVolume, maxVol, interval, xOf, yOf,
  ]);

  // ── interaction ───────────────────────────────────────────────────────────
  const indexAt = useCallback(
    (clientX: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || geom.barW === 0) return null;
      const i = start + Math.floor((clientX - rect.left - PAD.left) / geom.barW);
      return Math.max(start, Math.min(end - 1, i));
    },
    [start, end, geom.barW],
  );

  const onMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const i = indexAt(e.clientX);
    if (i == null || !rect) return;
    setHover({ i, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // Wheel-zoom must preventDefault, which React's passive listener can't do —
  // so it's bound imperatively.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (bars.length === 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - PAD.left) / Math.max(1, geom.plotW)));
      setView((v) => {
        const curStart = Math.max(0, v.end - v.count);
        const anchor = curStart + frac * v.count;
        const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
        const count = Math.round(Math.max(MIN_VISIBLE, Math.min(bars.length, v.count * factor)));
        // Keep the bar under the cursor pinned while the window resizes.
        const nextStart = Math.round(anchor - frac * count);
        const clampedStart = Math.max(0, Math.min(bars.length - count, nextStart));
        return { end: clampedStart + count, count };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bars.length, geom.plotW]);

  const drag = useRef<{ x: number; end: number } | null>(null);
  const onDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, end: view.end };
  };
  /** Single mousemove handler: always moves the crosshair, pans only mid-drag. */
  const onDrag = (e: React.MouseEvent) => {
    const d = drag.current;
    onMove(e);
    if (!d || geom.barW === 0) return;
    const shift = Math.round((d.x - e.clientX) / geom.barW);
    setView((v) => {
      const end = Math.max(v.count, Math.min(bars.length, d.end + shift));
      return { ...v, end };
    });
  };
  const endDrag = () => {
    drag.current = null;
  };

  // ── readout ───────────────────────────────────────────────────────────────
  const readIdx = hover?.i ?? end - 1;
  const readBar = bars[readIdx];
  const readPoint = points[readIdx];
  const decimals = priceDecimals(scale.span, (scale.hi + scale.lo) / 2);
  const chg = readBar && readIdx > 0 ? readBar.close / bars[readIdx - 1].close - 1 : null;

  if (bars.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-[var(--radius)] border border-dashed border-line text-xs text-[var(--faint)]"
        style={{ height }}
      >
        No price history.
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative select-none" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="block cursor-crosshair"
        onMouseMove={onDrag}
        onMouseDown={onDown}
        onMouseUp={endDrag}
        onMouseLeave={() => {
          endDrag();
          setHover(null);
        }}
        onDoubleClick={() =>
          setView({ end: bars.length, count: Math.min(bars.length, DEFAULT_VISIBLE) })
        }
      />

      {/* OHLC + study readout. HTML rather than canvas text so it picks up the
          app's type tokens and stays selectable. */}
      {readBar && (
        <div className="pointer-events-none absolute left-2 top-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 font-mono text-[10px] leading-tight">
          <span className="text-[var(--muted)]">{fmtFullTime(readBar.t, interval)}</span>
          <span className="text-[var(--faint)]">
            O<span className="ml-0.5 text-[var(--paper)]">{fmtPrice(readBar.open, decimals)}</span>
          </span>
          <span className="text-[var(--faint)]">
            H<span className="ml-0.5 text-[var(--paper)]">{fmtPrice(readBar.high, decimals)}</span>
          </span>
          <span className="text-[var(--faint)]">
            L<span className="ml-0.5 text-[var(--paper)]">{fmtPrice(readBar.low, decimals)}</span>
          </span>
          <span className="text-[var(--faint)]">
            C<span className="ml-0.5 text-[var(--paper)]">{fmtPrice(readBar.close, decimals)}</span>
          </span>
          {chg != null && (
            <span style={{ color: chg >= 0 ? "var(--jade)" : "var(--coral)" }}>
              {chg >= 0 ? "+" : ""}
              {(chg * 100).toFixed(2)}%
            </span>
          )}
          {readBar.volume != null && (
            <span className="text-[var(--faint)]">
              V<span className="ml-0.5 text-[var(--muted)]">{fmtVolume(readBar.volume)}</span>
            </span>
          )}
          <span className="text-[var(--faint)]">
            Hull{" "}
            <span
              style={{
                color:
                  readPoint?.up == null
                    ? "var(--muted)"
                    : readPoint.up
                      ? "var(--jade)"
                      : "var(--coral)",
              }}
            >
              {readPoint?.mhull != null ? fmtPrice(readPoint.mhull, decimals) : "—"}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

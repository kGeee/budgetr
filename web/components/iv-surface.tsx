"use client";

/**
 * Drag-rotatable 3D implied-volatility surface — the (strike × expiry × IV) grid
 * from `buildIvSurface` rendered as a shaded wire-mesh on a plain `<canvas>`, with
 * no 3D library. Projection, rotation, lighting and the painter's-algorithm depth
 * sort are all hand-rolled. Drag (mouse or touch) to orbit yaw/pitch, double-click
 * to reset. Theme-aware via the app's CSS variables; the IV heat ramp runs cool
 * (jade) → warm (coral). Matches the house SVG/canvas chart conventions.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatStrike } from "@/lib/options";
import { useResolvedTheme } from "@/lib/chart-theme";
import type { IvSurface as IvSurfaceData } from "@/lib/option-chain-analytics";

// ── Scene constants (world units, roughly ±1.2) ─────────────────────────────
const HALF_X = 1.18; // half-extent along the expiry (X) axis
const HALF_Y = 0.92; // half-extent along the strike (Y) axis
const MAX_H = 0.78; // peak height for the tallest IV
const CAM_DIST = 3.0; // camera distance along the view axis
const FOCAL = 2.6; // focal length → light perspective
const DEFAULT_YAW = -0.62;
const DEFAULT_PITCH = 0.92;
const MIN_PITCH = 0.22;
const MAX_PITCH = 1.45;

// Canvas margins (CSS px) — labels live in the gutters.
const MARGIN = { top: 16, right: 18, bottom: 30, left: 44 };

type RGB = { r: number; g: number; b: number };
type Vec3 = { x: number; y: number; z: number };

/** One projected grid vertex: canvas position, rotated 3D coords, depth, IV. */
type Node = {
  cx: number;
  cy: number;
  b: Vec3; // rotated (camera-space) coordinates, for lighting
  depth: number; // along the view axis; larger = farther
  iv: number;
};

export function IvSurface({
  surface,
  height = 360,
  className,
}: {
  surface: IvSurfaceData;
  height?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [width, setWidth] = useState(0);
  const [yaw, setYaw] = useState(DEFAULT_YAW);
  const [pitch, setPitch] = useState(DEFAULT_PITCH);
  const [interacted, setInteracted] = useState(false);

  // Drag state kept in a ref so pointer moves don't churn React state.
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  // ── Validity: need at least a 2×2 grid with some non-null IV ───────────────
  const E = surface.expiries.length;
  const S = surface.strikes.length;
  let hasData = false;
  for (const row of surface.z) {
    for (const v of row) {
      if (v != null && v > 0) {
        hasData = true;
        break;
      }
    }
    if (hasData) break;
  }
  const empty = E < 2 || S < 2 || !hasData;

  // ── Track container width (fills parent, fixed height) ─────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── The draw routine — depends on rotation, surface and size ───────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || empty || width <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = width;
    const h = height;
    // Size the backing store for high-DPI, then draw in CSS pixels.
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Theme colours (read live so the surface follows the page theme).
    const paper = readVar(canvas, "--paper", "#ece7da");
    const muted = readVar(canvas, "--muted", "#8b948c");
    const line = readVar(canvas, "--line", "#212a27");
    const brass = readVar(canvas, "--brass", "#cbb07c");
    const jade = parseColor(readVar(canvas, "--jade", "#6fe3a6"));
    const coral = parseColor(readVar(canvas, "--coral", "#f0897b"));
    const brassRgb = parseColor(brass);
    // Cool → mid → warm heat ramp for the IV values.
    const ramp = (t: number): RGB => {
      const c = clamp01(t);
      return c < 0.5
        ? lerpRgb(jade, brassRgb, c / 0.5)
        : lerpRgb(brassRgb, coral, (c - 0.5) / 0.5);
    };

    // IV range for normalisation + legend.
    let ivMin = Infinity;
    let ivMax = -Infinity;
    for (const row of surface.z) {
      for (const v of row) {
        if (v == null || !(v > 0)) continue;
        if (v < ivMin) ivMin = v;
        if (v > ivMax) ivMax = v;
      }
    }
    const ivSpan = ivMax - ivMin || 1;

    // World-space coordinates for a grid cell / height.
    const wx = (j: number) => (E === 1 ? 0 : j / (E - 1) - 0.5) * 2 * HALF_X;
    const wy = (i: number) => (S === 1 ? 0 : i / (S - 1) - 0.5) * 2 * HALF_Y;
    const wz = (iv: number) => ((iv - ivMin) / ivSpan) * MAX_H;

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    /**
     * Project a world point to raw (pre-fit) screen units. Rotate yaw about the
     * vertical (Z) axis, then pitch about X, then a light perspective divide.
     * Returns raw x (right), y (up) plus rotated coords `b` and view-axis depth.
     */
    const projectRaw = (
      x: number,
      y: number,
      z: number,
    ): { rx: number; ry: number; depth: number; b: Vec3 } => {
      // Yaw about the vertical axis.
      const ax = x * cosY - y * sinY;
      const ay = x * sinY + y * cosY;
      const az = z;
      // Pitch about the X axis.
      const bx = ax;
      const by = ay * cosP - az * sinP;
      const bz = ay * sinP + az * cosP;
      // Camera sits at by = -CAM_DIST looking toward +by.
      const d = by + CAM_DIST;
      const f = FOCAL / d;
      return { rx: bx * f, ry: bz * f, depth: by, b: { x: bx, y: by, z: bz } };
    };

    // First pass: project every valid vertex + the four base corners, and grow
    // a bounding box so the surface always fits the canvas at any rotation.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const grow = (rx: number, ry: number) => {
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    };

    type Raw = { rx: number; ry: number; depth: number; b: Vec3; iv: number } | null;
    const raw: Raw[][] = [];
    for (let i = 0; i < S; i++) {
      const rowOut: Raw[] = [];
      for (let j = 0; j < E; j++) {
        const iv = surface.z[i]?.[j];
        if (iv == null || !(iv > 0)) {
          rowOut.push(null);
          continue;
        }
        const p = projectRaw(wx(j), wy(i), wz(iv));
        grow(p.rx, p.ry);
        rowOut.push({ ...p, iv });
      }
      raw.push(rowOut);
    }
    // Base-plane corners keep the footprint grounded / framed.
    const corners = [
      projectRaw(wx(0), wy(0), 0),
      projectRaw(wx(E - 1), wy(0), 0),
      projectRaw(wx(E - 1), wy(S - 1), 0),
      projectRaw(wx(0), wy(S - 1), 0),
    ];
    for (const c of corners) grow(c.rx, c.ry);

    // Fit transform: uniform scale + centre inside the inner rect.
    const innerW = w - MARGIN.left - MARGIN.right;
    const innerH = h - MARGIN.top - MARGIN.bottom;
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const fit = Math.min(innerW / bw, innerH / bh);
    const drawW = bw * fit;
    const drawH = bh * fit;
    const offX = MARGIN.left + (innerW - drawW) / 2;
    const offY = MARGIN.top + (innerH - drawH) / 2;
    // ry is up-positive; canvas Y grows downward, so invert.
    const toX = (rx: number) => offX + (rx - minX) * fit;
    const toY = (ry: number) => offY + (maxY - ry) * fit;

    // Materialise nodes with final canvas coordinates.
    const nodes: (Node | null)[][] = raw.map((row) =>
      row.map((p) =>
        p ? { cx: toX(p.rx), cy: toY(p.ry), b: p.b, depth: p.depth, iv: p.iv } : null,
      ),
    );

    // Faint base outline for grounding.
    ctx.beginPath();
    corners.forEach((c, k) => {
      const x = toX(c.rx);
      const y = toY(c.ry);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.strokeStyle = withAlpha(line, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();

    // Second pass: build cell quads from 4 adjacent valid vertices.
    type Quad = { pts: Node[]; depth: number; iv: number; shade: number };
    const light = normalize({ x: 0.25, y: -0.55, z: 0.8 }); // upper-front
    const quads: Quad[] = [];
    for (let i = 0; i < S - 1; i++) {
      for (let j = 0; j < E - 1; j++) {
        const a = nodes[i][j];
        const b = nodes[i][j + 1];
        const c = nodes[i + 1][j + 1];
        const d = nodes[i + 1][j];
        if (!a || !b || !c || !d) continue; // skip holes in the chain
        const pts = [a, b, c, d];
        const depth = (a.depth + b.depth + c.depth + d.depth) / 4;
        const iv = (a.iv + b.iv + c.iv + d.iv) / 4;
        // Surface normal from two edges (in rotated space) → simple diffuse.
        const n = normalize(cross(sub(b.b, a.b), sub(d.b, a.b)));
        const shade = 0.62 + 0.55 * Math.abs(dot(n, light));
        quads.push({ pts, depth, iv, shade });
      }
    }
    // Painter's algorithm: farthest (largest depth) first so nearer quads win.
    quads.sort((p, q) => q.depth - p.depth);

    for (const quad of quads) {
      ctx.beginPath();
      quad.pts.forEach((p, k) => {
        if (k === 0) ctx.moveTo(p.cx, p.cy);
        else ctx.lineTo(p.cx, p.cy);
      });
      ctx.closePath();
      const base = ramp((quad.iv - ivMin) / ivSpan);
      ctx.fillStyle = rgbToCss(shadeRgb(base, quad.shade), 0.92);
      ctx.fill();
      ctx.strokeStyle = withAlpha(line, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Spot strike highlight: the surface polyline of the nearest strike row.
    if (surface.spot != null && surface.spot > 0) {
      let si = -1;
      let best = Infinity;
      for (let i = 0; i < S; i++) {
        const d = Math.abs(surface.strikes[i] - surface.spot);
        if (d < best) {
          best = d;
          si = i;
        }
      }
      if (si >= 0) {
        ctx.beginPath();
        let started = false;
        for (let j = 0; j < E; j++) {
          const n = nodes[si][j];
          if (!n) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(n.cx, n.cy);
            started = true;
          } else {
            ctx.lineTo(n.cx, n.cy);
          }
        }
        ctx.strokeStyle = brass;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // ── Axis ticks / labels (sparse, muted) ──────────────────────────────────
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = muted;

    // Strike ticks along the first-expiry (j=0) base edge.
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const i of sampleIndices(S, 5)) {
      const p = projectRaw(wx(0), wy(i), 0);
      const x = toX(p.rx);
      const y = toY(p.ry);
      ctx.fillText(formatStrike(surface.strikes[i]), x - 4, y);
    }

    // Expiry (DTE) ticks along the first-strike (i=0) base edge.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const j of sampleIndices(E, 5)) {
      const p = projectRaw(wx(j), wy(0), 0);
      const x = toX(p.rx);
      const y = toY(p.ry);
      ctx.fillText(`${surface.expiries[j].dte}d`, x, y + 4);
    }

    // ── IV colour legend (top-right corner) ──────────────────────────────────
    const lgW = 66;
    const lgH = 7;
    const lgX = w - MARGIN.right - lgW;
    const lgY = MARGIN.top;
    const steps = 24;
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      ctx.fillStyle = rgbToCss(ramp(t), 1);
      ctx.fillRect(lgX + t * (lgW - lgW / steps), lgY, lgW / steps + 1, lgH);
    }
    ctx.strokeStyle = withAlpha(line, 0.8);
    ctx.lineWidth = 1;
    ctx.strokeRect(lgX, lgY, lgW, lgH);
    ctx.fillStyle = muted;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(`${(ivMin * 100).toFixed(0)}%`, lgX, lgY + lgH + 3);
    ctx.textAlign = "right";
    ctx.fillText(`${(ivMax * 100).toFixed(0)}%`, lgX + lgW, lgY + lgH + 3);
    ctx.textAlign = "center";
    ctx.fillStyle = paper;
    ctx.fillText("IV", lgX + lgW / 2, lgY + lgH + 3);
  }, [empty, width, height, yaw, pitch, surface, E, S]);

  // Redraw whenever inputs change — rotation, size, data, and the resolved theme
  // (the canvas reads CSS-var colours live, so a flip needs an explicit repaint).
  const themeMode = useResolvedTheme();
  useEffect(() => {
    draw();
  }, [draw, themeMode]);

  // ── Pointer interaction: orbit yaw / pitch ─────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!interacted) setInteracted(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    setYaw((y) => y + dx * 0.01);
    setPitch((p) => Math.max(MIN_PITCH, Math.min(MAX_PITCH, p - dy * 0.01)));
  };
  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const onDoubleClick = () => {
    setYaw(DEFAULT_YAW);
    setPitch(DEFAULT_PITCH);
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-lg ${className ?? ""}`}
      style={{ height, border: "1px solid var(--line, #212a27)" }}
    >
      {empty ? (
        <div
          className="flex h-full w-full items-center justify-center px-6 text-center text-sm"
          style={{ color: "var(--muted, #8b948c)" }}
        >
          Not enough chain data to build a surface
        </div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={onDoubleClick}
          />
          <div
            className="pointer-events-none absolute bottom-2 right-3 text-[10px] transition-opacity duration-500"
            style={{
              color: "var(--muted, #8b948c)",
              opacity: interacted ? 0 : 0.7,
            }}
          >
            drag to rotate
          </div>
        </>
      )}
    </div>
  );
}

// ── Small colour + vector helpers ────────────────────────────────────────────

/** Read a CSS custom property off an element, falling back to `fallback`. */
function readVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** Parse `#rgb` / `#rrggbb` (or fall back to a mid grey). */
function parseColor(input: string): RGB {
  const s = input.trim();
  const hex = s.startsWith("#") ? s.slice(1) : s;
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if ([r, g, b].every(Number.isFinite)) return { r, g, b };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].every(Number.isFinite)) return { r, g, b };
  }
  return { r: 140, g: 148, b: 140 };
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const c = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * c,
    g: a.g + (b.g - a.g) * c,
    b: a.b + (b.b - a.b) * c,
  };
}

function shadeRgb(c: RGB, factor: number): RGB {
  const clip = (v: number) => Math.max(0, Math.min(255, v));
  return { r: clip(c.r * factor), g: clip(c.g * factor), b: clip(c.b * factor) };
}

function rgbToCss(c: RGB, alpha: number): string {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

/** Wrap any parsed colour string in an alpha via its RGB. */
function withAlpha(color: string, alpha: number): string {
  return rgbToCss(parseColor(color), alpha);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Up to `count` evenly-spaced indices spanning [0, n-1] (inclusive ends). */
function sampleIndices(n: number, count: number): number[] {
  if (n <= 1) return [0];
  const k = Math.min(count, n);
  const out: number[] = [];
  for (let s = 0; s < k; s++) {
    out.push(Math.round((s / (k - 1)) * (n - 1)));
  }
  return Array.from(new Set(out));
}

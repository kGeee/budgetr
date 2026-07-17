"use client";

/**
 * Theme-aware chart colors for recharts.
 *
 * recharts needs concrete color strings (gradients, computed color logic, tooltip
 * style objects can't all take `var(--x)`), so this reads the resolved CSS token
 * values from the document at runtime and re-reads them when the theme flips.
 * Replaces the hardcoded hex constant blocks that were duplicated across the
 * chart components. The dark values double as the SSR/first-paint fallback (they
 * match the current dark palette, so nothing shifts before hydration).
 */

import { useEffect, useMemo, useState } from "react";

export type ResolvedTheme = "dark" | "light";

function computeResolved(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  const choice = document.documentElement.getAttribute("data-theme");
  if (choice === "light") return "light";
  if (choice === "dark" || choice == null) return "dark";
  // "system" → follow the OS.
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * The concrete light/dark mode currently applied. Tracks the `data-theme`
 * attribute (flipped by the toggle) and, when set to "system", the OS setting.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [mode, setMode] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const update = () => setMode(computeResolved());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", update);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", update);
    };
  }, []);

  return mode;
}

export type ChartTheme = {
  grid: string;
  gridStrong: string;
  tick: { fill: string; fontSize: number; fontFamily: string };
  tooltipStyle: React.CSSProperties;
  labelStyle: { color: string; marginBottom: number };
  jade: string;
  coral: string;
  brass: string;
  blue: string;
  muted: string;
  paper: string;
  dotStroke: string;
};

// Dark palette — also the SSR fallback (matches the :root token values).
const DARK: Record<string, string> = {
  grid: "#212a27",
  gridStrong: "#303b37",
  muted: "#8b948c",
  tooltipBg: "#101413",
  paper: "#ece7da",
  jade: "#6fe3a6",
  coral: "#f0897b",
  brass: "#cbb07c",
  blue: "#7fb2e0",
  dotStroke: "#090c0b",
};

function build(read: (name: string, fallback: string) => string): ChartTheme {
  const grid = read("--chart-grid", DARK.grid);
  const gridStrong = read("--line-strong", DARK.gridStrong);
  const muted = read("--muted", DARK.muted);
  const paper = read("--paper", DARK.paper);
  const tooltipBg = read("--chart-tooltip-bg", DARK.tooltipBg);
  return {
    grid,
    gridStrong,
    muted,
    paper,
    tick: { fill: muted, fontSize: 11, fontFamily: "var(--font-mono)" },
    tooltipStyle: {
      background: tooltipBg,
      border: `1px solid ${gridStrong}`,
      borderRadius: 12,
      fontSize: 12,
      color: paper,
      padding: "8px 12px",
      boxShadow: "0 30px 60px -32px rgba(0,0,0,0.6)",
      fontFamily: "var(--font-mono)",
    },
    labelStyle: { color: muted, marginBottom: 2 },
    jade: read("--jade", DARK.jade),
    coral: read("--coral", DARK.coral),
    brass: read("--brass", DARK.brass),
    blue: read("--blue", DARK.blue),
    dotStroke: read("--chart-dot-stroke", DARK.dotStroke),
  };
}

/** Resolved recharts colors for the current theme; recomputes on theme flip. */
export function useChartTheme(): ChartTheme {
  const mode = useResolvedTheme();
  return useMemo(() => {
    if (typeof document === "undefined") return build((_n, fb) => fb);
    const cs = getComputedStyle(document.documentElement);
    return build((name, fb) => cs.getPropertyValue(name).trim() || fb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
}

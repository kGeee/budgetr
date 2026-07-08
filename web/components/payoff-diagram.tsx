"use client";

/**
 * Expiry payoff diagram — the signature "profit/loss vs. underlying price" curve
 * (OptionStrat-style). Fully derived from the payoff engine: profit is shaded
 * jade, loss coral, with markers for each breakeven and the live underlying
 * price. Pure SVG (no chart lib), theme-aware via CSS variables.
 */

import { useMemo } from "react";
import { formatStrike } from "@/lib/options";
import { payoffCurve, type PayoffLeg } from "@/lib/payoff";

const W = 560;
const H = 208;
const M = { top: 14, right: 16, bottom: 26, left: 16 };

export function PayoffDiagram({
  legs,
  currentPrice,
  breakevens,
  className = "",
}: {
  legs: PayoffLeg[];
  currentPrice?: number | null;
  breakevens?: number[];
  className?: string;
}) {
  const geo = useMemo(() => {
    const { points, min, max } = payoffCurve(legs, { center: currentPrice ?? null });
    if (points.length < 2 || max <= min) return null;

    const pnls = points.map((p) => p.pnl);
    let loY = Math.min(0, ...pnls);
    let hiY = Math.max(0, ...pnls);
    if (hiY === loY) hiY = loY + 1;
    const padY = (hiY - loY) * 0.12;
    loY -= padY;
    hiY += padY;

    const iw = W - M.left - M.right;
    const ih = H - M.top - M.bottom;
    const sx = (price: number) => M.left + ((price - min) / (max - min)) * iw;
    const sy = (pnl: number) => M.top + (1 - (pnl - loY) / (hiY - loY)) * ih;

    const zeroY = sy(0);
    const line = points.map((p) => `${sx(p.price)},${sy(p.pnl)}`).join(" ");
    // Area between the curve and the zero baseline; clipped halves colour it.
    const area = `M ${sx(points[0].price)},${zeroY} ${points
      .map((p) => `L ${sx(p.price)},${sy(p.pnl)}`)
      .join(" ")} L ${sx(points[points.length - 1].price)},${zeroY} Z`;

    const bes = (breakevens ?? []).filter((b) => b >= min && b <= max);
    return { points, min, max, sx, sy, zeroY, line, area, bes };
  }, [legs, currentPrice, breakevens]);

  if (!geo) return null;
  const { sx, sy, zeroY, line, area, bes, min, max } = geo;
  const clampX = (x: number) => Math.max(M.left, Math.min(W - M.right, x));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={`w-full ${className}`}
      style={{ height: "auto" }}
      role="img"
      aria-label="Option payoff at expiry"
    >
      <defs>
        <clipPath id="pf-profit">
          <rect x={0} y={0} width={W} height={zeroY} />
        </clipPath>
        <clipPath id="pf-loss">
          <rect x={0} y={zeroY} width={W} height={H - zeroY} />
        </clipPath>
      </defs>

      {/* Profit / loss fills */}
      <path d={area} fill="var(--jade)" opacity={0.16} clipPath="url(#pf-profit)" />
      <path d={area} fill="var(--coral)" opacity={0.16} clipPath="url(#pf-loss)" />

      {/* Zero P&L baseline */}
      <line
        x1={M.left}
        x2={W - M.right}
        y1={zeroY}
        y2={zeroY}
        stroke="var(--line-strong)"
        strokeWidth={1}
      />

      {/* The payoff curve, coloured by side of zero */}
      <polyline points={line} fill="none" stroke="var(--jade)" strokeWidth={2} clipPath="url(#pf-profit)" />
      <polyline points={line} fill="none" stroke="var(--coral)" strokeWidth={2} clipPath="url(#pf-loss)" />

      {/* Breakeven markers */}
      {bes.map((be, i) => (
        <g key={`be-${i}`}>
          <line
            x1={sx(be)}
            x2={sx(be)}
            y1={M.top}
            y2={H - M.bottom}
            stroke="var(--brass)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
          />
          <text
            x={clampX(sx(be))}
            y={H - 8}
            textAnchor="middle"
            fontSize={10}
            fill="var(--brass)"
            className="mono"
          >
            {formatStrike(Number(be.toFixed(2)))}
          </text>
        </g>
      ))}

      {/* Current underlying price marker */}
      {currentPrice != null && currentPrice >= min && currentPrice <= max && (
        <g>
          <line
            x1={sx(currentPrice)}
            x2={sx(currentPrice)}
            y1={M.top}
            y2={H - M.bottom}
            stroke="var(--paper)"
            strokeWidth={1}
            opacity={0.5}
          />
          <circle cx={sx(currentPrice)} cy={sy(payoffAt(geo.points, currentPrice))} r={3} fill="var(--paper)" />
          <text
            x={clampX(sx(currentPrice))}
            y={M.top + 2}
            textAnchor="middle"
            fontSize={10}
            fill="var(--paper)"
            className="mono"
          >
            {formatStrike(Number(currentPrice.toFixed(2)))}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Linear-interpolated P&L on the (already exact) polyline at price `x`. */
function payoffAt(points: { price: number; pnl: number }[], x: number): number {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.price && x <= b.price) {
      const t = b.price === a.price ? 0 : (x - a.price) / (b.price - a.price);
      return a.pnl + t * (b.pnl - a.pnl);
    }
  }
  return points[x <= points[0].price ? 0 : points.length - 1].pnl;
}

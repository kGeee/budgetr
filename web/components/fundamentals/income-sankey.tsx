"use client";

/**
 * Interactive income-statement Sankey (App Economy Insights style): the profit
 * spine flows left→right in jade, costs bleed off in coral. Hover any node or
 * flow for the exact figure. Data comes from SEC companyfacts (see lib/sec.ts).
 */

import { ResponsiveContainer, Sankey, Tooltip, Layer, Rectangle } from "recharts";
import type { SankeyData, SankeyNode } from "@/lib/fundamentals/income-statement";

const COLORS: Record<SankeyNode["kind"], string> = {
  revenue: "var(--brass)",
  profit: "var(--jade)",
  cost: "var(--coral)",
};

function fmtB(n: number): string {
  const b = n / 1e9;
  if (Math.abs(b) >= 1) return `$${b.toFixed(1)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

type NodeProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: SankeyNode & { value: number };
};

function SankeyNodeShape({ x, y, width, height, payload }: NodeProps) {
  const color = COLORS[payload.kind] ?? "var(--muted)";
  const right = x < 320; // labels for left/middle nodes go to the right, else left
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.9} radius={2} />
      <text
        x={right ? x + width + 8 : x - 8}
        y={y + height / 2}
        textAnchor={right ? "start" : "end"}
        dominantBaseline="middle"
        fontSize={12}
        fill="var(--paper)"
      >
        <tspan fontWeight={600}>{payload.name}</tspan>
        <tspan fill="var(--muted)"> {fmtB(payload.value)}</tspan>
      </text>
    </Layer>
  );
}

type LinkProps = {
  sourceX: number;
  targetX: number;
  sourceY: number;
  targetY: number;
  sourceControlX: number;
  targetControlX: number;
  linkWidth: number;
  index: number;
  payload: { target: SankeyNode; value: number };
};

function SankeyLinkShape(props: LinkProps) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props;
  const isCost = payload.target?.kind === "cost";
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={isCost ? "var(--coral)" : "var(--jade)"}
      strokeOpacity={0.22}
      strokeWidth={Math.max(1, linkWidth)}
    />
  );
}

export function IncomeSankey({ data }: { data: SankeyData }) {
  if (!data.links.length) {
    return <p className="py-10 text-center text-sm text-[var(--muted)]">Not enough reported data to chart.</p>;
  }
  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={data}
          nodePadding={26}
          nodeWidth={12}
          margin={{ top: 12, right: 120, bottom: 12, left: 96 }}
          // recharts v3's SankeyNode/LinkOptions types omit the render-function
          // form these accept at runtime; cast past the typing gap.
          node={((props: NodeProps) => <SankeyNodeShape {...props} />) as never}
          link={((props: LinkProps) => <SankeyLinkShape {...props} />) as never}
        >
          <Tooltip
            formatter={((value: number) => fmtB(value)) as never}
            contentStyle={{
              background: "var(--chart-tooltip-bg)",
              border: "1px solid var(--line-strong)",
              borderRadius: 12,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
            itemStyle={{ color: "var(--muted)" }}
            labelStyle={{ color: "var(--paper)" }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}

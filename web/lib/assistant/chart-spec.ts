/**
 * The chart spec the assistant draws with. Claude never writes code or HTML for
 * a visual: it calls the `render_chart` tool with plain data in this shape, the
 * server validates it here, and the client draws it with the app's own Recharts
 * components. Anything that doesn't validate is sent back to Claude as a tool
 * error so it can fix the call; it never reaches the screen.
 *
 * Pure (no DB, no React), so the route, the client and the tests share it.
 */

export const CHART_TYPES = ["line", "bar", "pie", "table"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_UNITS = ["currency", "number", "percent"] as const;
export type ChartUnit = (typeof CHART_UNITS)[number];

export type ChartSeries = { name: string; values: number[] };

export type SeriesChartSpec = {
  type: "line" | "bar" | "pie";
  title: string;
  subtitle?: string;
  unit: ChartUnit;
  /** X-axis categories (line/bar) or slice names (pie). */
  labels: string[];
  /** One value per label in each series. A pie has exactly one series. */
  series: ChartSeries[];
};

export type TableChartSpec = {
  type: "table";
  title: string;
  subtitle?: string;
  unit: ChartUnit;
  columns: string[];
  rows: (string | number)[][];
};

export type ChartSpec = SeriesChartSpec | TableChartSpec;

export const CHART_LIMITS = {
  title: 120,
  label: 60,
  cell: 80,
  points: 120,
  series: 6,
  slices: 12,
  columns: 6,
  rows: 40,
} as const;

/** The input schema handed to Claude for the render_chart tool. */
export const CHART_INPUT_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [...CHART_TYPES],
      description:
        "line for change over time, bar for comparing categories or periods, pie for parts of a whole (one series, positive values), table for exact figures.",
    },
    title: { type: "string", description: "Short title, e.g. 'Dining out by month'." },
    subtitle: { type: "string", description: "Optional one-line context, e.g. the date range." },
    unit: {
      type: "string",
      enum: [...CHART_UNITS],
      description: "How values are formatted. Use currency for money.",
    },
    labels: {
      type: "array",
      items: { type: "string" },
      description:
        "line/bar/pie only: x-axis labels or slice names, in display order. Use 'YYYY-MM' for months and 'YYYY-MM-DD' for days.",
    },
    series: {
      type: "array",
      description: "line/bar/pie only: each series has one value per label.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          values: { type: "array", items: { type: "number" } },
        },
        required: ["name", "values"],
      },
    },
    columns: {
      type: "array",
      items: { type: "string" },
      description: "table only: column headings.",
    },
    rows: {
      type: "array",
      description:
        "table only: one array per row, one cell per column. Number cells are formatted with unit; pass anything else (counts, dates, names) as a string.",
      items: { type: "array", items: { type: ["string", "number"] } },
    },
  },
  required: ["type", "title"],
} as const;

export type ParseResult = { ok: true; spec: ChartSpec } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A trimmed string cut to `max` characters, or null when it isn't a string. */
function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Validate Claude's render_chart input. */
export function parseChartSpec(input: unknown): ParseResult {
  if (!isObj(input)) return { ok: false, error: "Chart input must be an object." };

  const type = input.type;
  if (typeof type !== "string" || !(CHART_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `type must be one of ${CHART_TYPES.join(", ")}.` };
  }
  const title = str(input.title, CHART_LIMITS.title);
  if (!title) return { ok: false, error: "title is required." };
  const subtitle = input.subtitle == null ? undefined : (str(input.subtitle, CHART_LIMITS.title) ?? undefined);

  const unitIn = input.unit ?? "currency";
  if (typeof unitIn !== "string" || !(CHART_UNITS as readonly string[]).includes(unitIn)) {
    return { ok: false, error: `unit must be one of ${CHART_UNITS.join(", ")}.` };
  }
  const unit = unitIn as ChartUnit;

  if (type === "table") return parseTable(input, title, subtitle, unit);
  return parseSeries(input, type as SeriesChartSpec["type"], title, subtitle, unit);
}

function parseSeries(
  input: Record<string, unknown>,
  type: SeriesChartSpec["type"],
  title: string,
  subtitle: string | undefined,
  unit: ChartUnit,
): ParseResult {
  if (!Array.isArray(input.labels) || input.labels.length === 0) {
    return { ok: false, error: "labels must be a non-empty array of strings." };
  }
  const maxPoints = type === "pie" ? CHART_LIMITS.slices : CHART_LIMITS.points;
  if (input.labels.length > maxPoints) {
    return {
      ok: false,
      error: `Too many labels (${input.labels.length}); a ${type} chart takes at most ${maxPoints}. Aggregate first${type === "pie" ? " and group the rest as 'Other'" : ""}.`,
    };
  }
  const labels: string[] = [];
  for (const l of input.labels) {
    const s = typeof l === "number" ? String(l) : str(l, CHART_LIMITS.label);
    if (s == null) return { ok: false, error: "Every label must be a string." };
    labels.push(s);
  }

  if (!Array.isArray(input.series) || input.series.length === 0) {
    return { ok: false, error: "series must be a non-empty array." };
  }
  if (type === "pie" && input.series.length !== 1) {
    return { ok: false, error: "A pie chart takes exactly one series." };
  }
  if (input.series.length > CHART_LIMITS.series) {
    return { ok: false, error: `At most ${CHART_LIMITS.series} series per chart.` };
  }

  const series: ChartSeries[] = [];
  for (const [i, s] of input.series.entries()) {
    if (!isObj(s)) return { ok: false, error: `series[${i}] must be an object.` };
    const name = str(s.name, CHART_LIMITS.label) || `Series ${i + 1}`;
    if (!Array.isArray(s.values) || s.values.length !== labels.length) {
      return {
        ok: false,
        error: `series[${i}].values must have exactly one number per label (${labels.length}).`,
      };
    }
    const values: number[] = [];
    for (const v of s.values) {
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) {
        return { ok: false, error: `series[${i}].values must all be finite numbers.` };
      }
      if (type === "pie" && n < 0) {
        return { ok: false, error: "Pie values must be zero or positive; use a bar chart for signed values." };
      }
      values.push(n);
    }
    series.push({ name, values });
  }
  if (type === "pie" && series[0].values.every((v) => v === 0)) {
    return { ok: false, error: "A pie chart needs at least one positive value." };
  }

  return { ok: true, spec: { type, title, subtitle, unit, labels, series } };
}

function parseTable(
  input: Record<string, unknown>,
  title: string,
  subtitle: string | undefined,
  unit: ChartUnit,
): ParseResult {
  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    return { ok: false, error: "columns must be a non-empty array of strings." };
  }
  if (input.columns.length > CHART_LIMITS.columns) {
    return { ok: false, error: `At most ${CHART_LIMITS.columns} columns.` };
  }
  const columns: string[] = [];
  for (const c of input.columns) {
    const s = str(c, CHART_LIMITS.label);
    if (s == null) return { ok: false, error: "Every column heading must be a string." };
    columns.push(s);
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    return { ok: false, error: "rows must be a non-empty array." };
  }
  if (input.rows.length > CHART_LIMITS.rows) {
    return { ok: false, error: `At most ${CHART_LIMITS.rows} rows; summarise or show the top rows.` };
  }
  const rows: (string | number)[][] = [];
  for (const [i, r] of input.rows.entries()) {
    if (!Array.isArray(r) || r.length !== columns.length) {
      return { ok: false, error: `rows[${i}] must have exactly ${columns.length} cells.` };
    }
    const row: (string | number)[] = [];
    for (const cell of r) {
      if (typeof cell === "number") {
        if (!Number.isFinite(cell)) return { ok: false, error: `rows[${i}] has a non-finite number.` };
        row.push(cell);
      } else {
        const s = str(cell, CHART_LIMITS.cell);
        if (s == null) return { ok: false, error: `rows[${i}] cells must be strings or numbers.` };
        row.push(s);
      }
    }
    rows.push(row);
  }
  return { ok: true, spec: { type: "table", title, subtitle, unit, columns, rows } };
}

/** One line describing a chart, used when replaying history to Claude. */
export function describeChart(spec: ChartSpec): string {
  return `[Showed the user a ${spec.type === "table" ? "table" : `${spec.type} chart`}: ${spec.title}]`;
}

/**
 * CSV reader — the messy adapter to OFX's structured backbone.
 *
 * Broker CSVs routinely bury the real header under title/disclaimer rows and
 * append footer totals. We locate the header row by scanning for one that carries
 * several recognizable field words, parse from there with papaparse, and drop
 * trailing non-data rows. The column→field mapping and sign handling live in
 * csv-adapter.ts / brokers.ts; this module only turns bytes into labeled rows.
 */
import Papa from "papaparse";

export type CsvTable = { headers: string[]; rows: Record<string, string>[] };

const HEADER_HINTS = [
  "date",
  "symbol",
  "action",
  "quantity",
  "qty",
  "amount",
  "price",
  "description",
  "type",
  "shares",
];

/** Score a line by how many header-ish words it contains. */
function headerScore(line: string): number {
  const low = line.toLowerCase();
  return HEADER_HINTS.reduce((n, h) => (low.includes(h) ? n + 1 : n), 0);
}

/** Find the most header-like line in the first ~15 lines (skips preambles). */
function findHeaderLine(text: string): number {
  const lines = text.split(/\r?\n/);
  let best = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const s = headerScore(lines[i]);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return bestScore >= 2 ? best : 0;
}

export function parseCsv(text: string): CsvTable {
  const start = findHeaderLine(text);
  const body = start > 0 ? text.split(/\r?\n/).slice(start).join("\n") : text;

  const res = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const headers = (res.meta.fields ?? []).map((h) => h.trim()).filter(Boolean);
  // Drop footer/summary rows: keep only rows that have a value in a majority of
  // columns (broker totals lines are mostly blank).
  const rows = res.data.filter((r) => {
    const filled = headers.filter((h) => (r[h] ?? "").trim() !== "").length;
    return filled >= Math.max(2, Math.ceil(headers.length / 2));
  });

  return { headers, rows };
}

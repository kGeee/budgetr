import { NextRequest, NextResponse } from "next/server";
import { getRealizedGains } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** CSV-escape a cell: wrap in quotes and double any embedded quotes. */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function round(n: number): string {
  return n.toFixed(2);
}

/**
 * GET /api/tax/realized-gains?year=2024
 *
 * Streams a capital-gains worksheet as CSV built from the reconstructed
 * FIFO/LIFO/spec-ID lots. Section 1256 rows are labeled for Form 6781 rather
 * than implied to be ordinary Form 8949 dispositions. Omit `year` to export all.
 */
export async function GET(req: NextRequest) {
  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;

  const { lots } = getRealizedGains(year);

  const header = [
    "Ticker",
    "Position",
    "Opened",
    "Closed",
    "Quantity",
    "Proceeds",
    "Cost Basis",
    "Gain/Loss",
    "Term",
    "Wash Sale",
    "Disallowed Loss",
  ];

  const rows = lots.map((l) =>
    [
      l.ticker,
      l.position === "short" ? "Written" : "Long",
      l.openDate,
      l.closeDate,
      l.quantity,
      round(l.proceeds),
      round(l.basis),
      round(l.gain),
      l.section1256
        ? "Section 1256 (60% long / 40% short)"
        : l.term === "long"
          ? "Long-term"
          : "Short-term",
      l.washSale ? "W" : "",
      l.washSale && l.gain < 0 ? round(-l.gain) : "",
    ].map(csvCell).join(","),
  );

  const csv = [header.map(csvCell).join(","), ...rows].join("\r\n") + "\r\n";

  const filename = `realized-gains-${year ?? "all"}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

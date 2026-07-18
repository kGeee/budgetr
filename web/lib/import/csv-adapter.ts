/**
 * Generic CSV → CanonicalTrade transform. Every broker (hardcoded or user-mapped)
 * is just a column mapping + a sign rule over this one tested transform, so the
 * "sign conventions are chaos" problem is solved once here: we take magnitudes
 * from the file and force sign from the resolved action, exactly like the OFX
 * canonicalizer.
 */
import type { CanonicalTrade } from "@/lib/import/canonicalize";
import type { TradeSide } from "@/lib/import/fingerprint";

export type FieldKey =
  | "date"
  | "symbol"
  | "action"
  | "quantity"
  | "price"
  | "amount"
  | "fees"
  | "description";

/** field → CSV column header. */
export type ColumnMap = Partial<Record<FieldKey, string>>;

/** How to derive buy/sell direction when there's no explicit action column. */
export type SignRule = "action" | "signedQuantity";

export type CsvMapping = {
  columns: ColumnMap;
  sign: SignRule;
};

// ── value parsing ────────────────────────────────────────────────────────────

/** "$1,234.56", "(1,234.56)", "-1,234.56" → signed number (null if unparseable). */
export function parseMoney(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (!s || s === "--" || s === "N/A") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? sign * n : null;
}

/** Parse ISO, MM/DD/YYYY, M/D/YY, YYYYMMDD → YYYY-MM-DD (null if unparseable). */
export function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // Leading-anchored (not end-anchored) so a trailing time/comma is tolerated,
  // e.g. IBKR's "2019-01-02, 10:00:00".
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
    const [, mo, d, yRaw] = m;
    const y = yRaw.length === 2 ? (Number(yRaw) > 70 ? `19${yRaw}` : `20${yRaw}`) : yRaw;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

const OCC_RE = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/;

/** Map free-text broker action language to a canonical side. */
export function parseSide(text: string | null | undefined): TradeSide | null {
  const t = (text ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!t) return null;
  if (/(BUYTOOPEN|BOUGHTTOOPEN|BTO)/.test(t)) return "buyToOpen";
  if (/(SELLTOCLOSE|SOLDTOCLOSE|STC)/.test(t)) return "sellToClose";
  if (/(SELLTOOPEN|SOLDTOOPEN|STO)/.test(t)) return "sellToOpen";
  if (/(BUYTOCLOSE|BOUGHTTOCLOSE|BTC)/.test(t)) return "buyToClose";
  if (/(REINVEST)/.test(t)) return "buy";
  if (/(BUY|BOUGHT|PURCHASE)/.test(t)) return "buy";
  if (/(SELL|SOLD)/.test(t)) return "sell";
  return null;
}

const NAME_FOR_SIDE: Record<TradeSide, string> = {
  buy: "BUY",
  sell: "SELL",
  buyToOpen: "BUYTOOPEN",
  buyToClose: "BUYTOCLOSE",
  sellToClose: "SELLTOCLOSE",
  sellToOpen: "SELLTOOPEN",
};

function isBuySide(side: TradeSide): boolean {
  return side === "buy" || side === "buyToOpen" || side === "buyToClose";
}

// ── transform ────────────────────────────────────────────────────────────────

export type CsvConvertResult = { trades: CanonicalTrade[]; skipped: number };

/**
 * Convert mapped CSV rows to canonical trades. Rows whose action can't be
 * resolved to buy/sell (dividends, transfers, journal entries, footer totals)
 * are skipped and counted — never guessed into a phantom position.
 */
export function csvToCanonical(rows: Record<string, string>[], mapping: CsvMapping): CsvConvertResult {
  const { columns: c, sign } = mapping;
  const get = (row: Record<string, string>, key: FieldKey): string | undefined =>
    c[key] ? row[c[key]!] : undefined;

  const trades: CanonicalTrade[] = [];
  let skipped = 0;

  for (const row of rows) {
    const date = parseDate(get(row, "date"));
    const symbolRaw = (get(row, "symbol") ?? "").trim().toUpperCase();
    if (!date || !symbolRaw) {
      skipped++;
      continue;
    }

    const actionText = get(row, "action") ?? get(row, "description") ?? "";
    const qtyMag = Math.abs(parseMoney(get(row, "quantity")) ?? NaN);

    // Resolve side.
    let side: TradeSide | null = sign === "action" ? parseSide(actionText) : null;
    if (!side) {
      const q = parseMoney(get(row, "quantity"));
      if (q != null && q !== 0) side = q > 0 ? "buy" : "sell";
    }
    if (!side || !Number.isFinite(qtyMag)) {
      skipped++;
      continue;
    }

    const price = parseMoney(get(row, "price"));
    const feeVal = parseMoney(get(row, "fees")) ?? 0;
    const amtRaw = parseMoney(get(row, "amount"));
    const amountMag =
      amtRaw != null ? Math.abs(amtRaw) : price != null ? qtyMag * price + Math.abs(feeVal) : null;

    const buy = isBuySide(side);
    const isOption = OCC_RE.test(symbolRaw) || /\b(CALL|PUT)\b/i.test(actionText);

    trades.push({
      fitid: null,
      date,
      ticker: symbolRaw,
      securityName: null,
      securityType: isOption ? "option" : null,
      isoCurrencyCode: null,
      type: buy ? "buy" : "sell",
      subtype: null,
      name: NAME_FOR_SIDE[side],
      side,
      quantity: buy ? qtyMag : -qtyMag,
      amount: amountMag == null ? null : buy ? amountMag : -amountMag,
      price,
      fees: Math.abs(feeVal),
      isOption,
    });
  }

  return { trades, skipped };
}

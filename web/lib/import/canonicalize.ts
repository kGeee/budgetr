/**
 * Map a parsed OFX document onto the tax-lot engine's exact conventions.
 *
 * The engine (lib/tax-lots.ts) reads direction from `type` ('buy'|'sell') for
 * equities and from tokens in `name` (BUYTOOPEN / SELLTOCLOSE / …) for options,
 * stores the FULL-dollar option premium in `amount` (no ×100 re-multiply), and
 * uses `Math.abs()` on quantity/amount. Every broker disagrees on sign, so we
 * normalize here: magnitude from OFX, sign forced from the action. That quarantines
 * "sign conventions are chaos" to this one file.
 */
import type { OfxDocument, OfxTxn, OfxSecurity } from "@/lib/import/ofx";
import type { TradeSide } from "@/lib/import/fingerprint";

/** Engine-ready trade, minus the id/account which the import service assigns. */
export type CanonicalTrade = {
  fitid: string | null;
  date: string; // YYYY-MM-DD
  ticker: string | null;
  securityName: string | null;
  securityType: string | null;
  isoCurrencyCode: string | null;
  type: "buy" | "sell" | "cash"; // engine type
  subtype: string | null; // income kind for the dividend engine
  name: string; // carries option open/close tokens
  side: TradeSide; // feeds the fingerprint
  quantity: number | null; // engine sign: + buy, − sell
  amount: number | null; // engine sign: + cash out (buy), − cash in (sell)
  price: number | null;
  fees: number | null;
  isOption: boolean;
};

/** OFX INCOMETYPE → a subtype token the dividend view recognizes. */
function incomeSubtype(t: string | null): string {
  switch ((t ?? "").toUpperCase()) {
    case "DIV":
    case "DIVIDEND":
      return "DIVIDEND";
    case "INTEREST":
      return "INTEREST";
    case "CGLONG":
    case "LTCG":
      return "LONG TERM CAP GAIN";
    case "CGSHORT":
    case "STCG":
      return "SHORT TERM CAP GAIN";
    default:
      return t ? t.toUpperCase() : "INCOME";
  }
}

/**
 * Resolve the ticker the engine will group on. Equities use the SECLIST ticker.
 * Options need the full OCC symbol for §1256 detection — we use the broker's
 * ticker when it's already OCC-shaped, otherwise synthesize one from the option
 * fields so trades never fall through with a null ticker (which the engine drops).
 */
function resolveTicker(sec: OfxSecurity | undefined, fallback: string | null): string | null {
  if (!sec) return fallback;
  if (sec.ticker) return sec.ticker.toUpperCase();
  if (sec.kind === "option" && sec.option) {
    const root = (sec.name ?? "").replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase();
    const { expiry, type, strike } = sec.option;
    if (root && expiry && type && strike != null) {
      const yymmdd = expiry.replace(/-/g, "").slice(2); // YYMMDD
      const cp = type === "PUT" ? "P" : "C";
      const strike8 = String(Math.round(strike * 1000)).padStart(8, "0");
      return `${root}${yymmdd}${cp}${strike8}`;
    }
  }
  return fallback ?? sec.uniqueId;
}

function optionName(optAction: OfxTxn["optAction"]): { name: string; side: TradeSide } {
  switch (optAction) {
    case "BUYTOOPEN":
      return { name: "BUYTOOPEN", side: "buyToOpen" };
    case "BUYTOCLOSE":
      return { name: "BUYTOCLOSE", side: "buyToClose" };
    case "SELLTOCLOSE":
      return { name: "SELLTOCLOSE", side: "sellToClose" };
    case "SELLTOOPEN":
      return { name: "SELLTOOPEN", side: "sellToOpen" };
    default:
      return { name: "BUYTOOPEN", side: "buyToOpen" };
  }
}

function one(txn: OfxTxn, sec: OfxSecurity | undefined): CanonicalTrade {
  const ticker = resolveTicker(sec, null);
  const qtyMag = txn.units == null ? null : Math.abs(txn.units);
  // OFX TOTAL is signed opposite the engine (− debit / + credit); flip it. Fall
  // back to units×price ± fees only when TOTAL is absent.
  const amountMag =
    txn.total != null
      ? Math.abs(txn.total)
      : txn.units != null && txn.unitPrice != null
        ? Math.abs(txn.units) * txn.unitPrice + (txn.fees ?? 0)
        : null;

  const base = {
    fitid: txn.fitid,
    date: txn.date,
    ticker,
    securityName: sec?.name ?? null,
    securityType: sec?.kind === "option" ? "option" : (sec?.kind ?? null),
    isoCurrencyCode: null as string | null,
    price: txn.unitPrice,
    fees: txn.fees,
    isOption: txn.isOption,
  };

  if (txn.action === "income") {
    return {
      ...base,
      type: "cash",
      subtype: incomeSubtype(txn.incomeType),
      name: incomeSubtype(txn.incomeType),
      side: "buy",
      quantity: null,
      amount: amountMag, // dividends carry a positive cash figure
    };
  }

  // reinvest acquires shares → treat as a buy for cost basis
  if (txn.isOption) {
    const { name, side } = optionName(txn.optAction);
    const isBuy = side === "buyToOpen" || side === "buyToClose";
    return {
      ...base,
      type: isBuy ? "buy" : "sell",
      subtype: null,
      name,
      side,
      quantity: qtyMag == null ? null : isBuy ? qtyMag : -qtyMag,
      amount: amountMag == null ? null : isBuy ? amountMag : -amountMag,
    };
  }

  const isBuy = txn.action === "buy" || txn.action === "reinvest";
  return {
    ...base,
    type: isBuy ? "buy" : "sell",
    subtype: null,
    name: txn.action === "reinvest" ? "REINVEST" : isBuy ? "BUY" : "SELL",
    side: isBuy ? "buy" : "sell",
    quantity: qtyMag == null ? null : isBuy ? qtyMag : -qtyMag,
    amount: amountMag == null ? null : isBuy ? amountMag : -amountMag,
  };
}

/** Canonicalize every transaction in a parsed OFX document. */
export function canonicalizeOfx(doc: OfxDocument): CanonicalTrade[] {
  return doc.transactions.map((t) => one(t, t.secId ? doc.securities.get(t.secId) : undefined));
}

/**
 * Hardcoded CSV profiles for the top brokers — the "it just knew my Schwab file"
 * moment. Each is a header signature (for auto-detect) plus a field→column map and
 * a sign rule over the generic csv-adapter. We deliberately hardcode only the
 * common few; everything else falls to the column-mapper UI and a saved profile.
 *
 * Column names are matched case-insensitively and trimmed, so small header drift
 * (a trailing space, different case) still resolves.
 */
import type { ColumnMap, CsvMapping, FieldKey, SignRule } from "@/lib/import/csv-adapter";

export type BrokerProfile = {
  key: string;
  label: string;
  /** Lowercased header words that must all be present to auto-detect. */
  signature: string[];
  /** field → canonical column header (resolved case-insensitively at run time). */
  columns: ColumnMap;
  sign: SignRule;
};

export const BROKERS: BrokerProfile[] = [
  {
    key: "schwab",
    label: "Charles Schwab",
    signature: ["action", "symbol", "quantity", "fees & comm", "amount"],
    columns: {
      date: "Date",
      action: "Action",
      symbol: "Symbol",
      description: "Description",
      quantity: "Quantity",
      price: "Price",
      fees: "Fees & Comm",
      amount: "Amount",
    },
    sign: "action",
  },
  {
    key: "fidelity",
    label: "Fidelity",
    signature: ["run date", "action", "symbol", "quantity", "amount ($)"],
    columns: {
      date: "Run Date",
      action: "Action",
      symbol: "Symbol",
      description: "Description",
      quantity: "Quantity",
      price: "Price ($)",
      fees: "Fees ($)",
      amount: "Amount ($)",
    },
    sign: "action",
  },
  {
    key: "etrade",
    label: "E*Trade",
    signature: ["transactiondate", "transactiontype", "symbol", "quantity", "amount"],
    columns: {
      date: "TransactionDate",
      action: "TransactionType",
      symbol: "Symbol",
      quantity: "Quantity",
      price: "Price",
      fees: "Commission",
      amount: "Amount",
    },
    sign: "action",
  },
  {
    key: "tastytrade",
    label: "Tastytrade",
    signature: ["symbol", "action", "instrument type", "quantity"],
    columns: {
      date: "Date",
      action: "Action",
      symbol: "Symbol",
      description: "Description",
      quantity: "Quantity",
      price: "Average Price",
      fees: "Fees",
      amount: "Value",
    },
    sign: "action",
  },
  {
    key: "ibkr",
    label: "Interactive Brokers",
    // IBKR trade CSVs use signed quantity and have no action column.
    signature: ["symbol", "quantity", "t. price", "proceeds"],
    columns: {
      date: "Date/Time",
      symbol: "Symbol",
      quantity: "Quantity",
      price: "T. Price",
      fees: "Comm/Fee",
      amount: "Proceeds",
    },
    sign: "signedQuantity",
  },
];

/** Normalize a header for matching. */
const norm = (s: string) => s.trim().toLowerCase();

/** Detect a known broker from the parsed headers, or null for the long tail. */
export function detectBroker(headers: string[]): BrokerProfile | null {
  const low = headers.map(norm);
  for (const b of BROKERS) {
    if (b.signature.every((sig) => low.some((h) => h.includes(sig)))) return b;
  }
  return null;
}

/**
 * Resolve a broker's canonical column names against the file's actual headers
 * (case-insensitive), producing a mapping the adapter can index rows with.
 */
export function resolveMapping(headers: string[], broker: BrokerProfile): CsvMapping {
  const byLow = new Map(headers.map((h) => [norm(h), h]));
  const columns: ColumnMap = {};
  for (const [field, canonical] of Object.entries(broker.columns) as [FieldKey, string][]) {
    const actual = byLow.get(norm(canonical));
    if (actual) columns[field] = actual;
  }
  return { columns, sign: broker.sign };
}

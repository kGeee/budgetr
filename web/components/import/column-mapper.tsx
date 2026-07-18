"use client";

/**
 * Column-mapper for CSVs we don't recognize (the long tail beyond the hardcoded
 * top brokers). The user maps each field to one of the file's columns; we preview
 * the resulting positions before anything is written. The mapping can be reused —
 * the parent threads it into commit.
 */

import { useMemo, useState, useTransition } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { previewCsvMappedAction, type PreviewResult } from "@/lib/actions-import";
import type { CsvMapping, FieldKey, SignRule } from "@/lib/import/csv-adapter";
import type { ReconcileSummary } from "@/lib/import/import-service";

const FIELDS: { key: FieldKey; label: string; required?: boolean; hint?: string }[] = [
  { key: "date", label: "Trade date", required: true },
  { key: "symbol", label: "Symbol", required: true },
  { key: "action", label: "Action / type", hint: "Buy, Sell, BTO, STC…" },
  { key: "quantity", label: "Quantity", required: true },
  { key: "price", label: "Price" },
  { key: "amount", label: "Amount / value" },
  { key: "fees", label: "Fees / commission" },
];

/** Best-guess a column for a field from its header name. */
function guess(headers: string[], key: FieldKey): string {
  const pats: Record<FieldKey, RegExp> = {
    date: /date/i,
    symbol: /symbol|ticker/i,
    action: /action|type|side|transaction/i,
    quantity: /quantity|qty|shares/i,
    price: /price/i,
    amount: /amount|value|proceeds|net/i,
    fees: /fee|comm/i,
    description: /desc/i,
  };
  return headers.find((h) => pats[key].test(h)) ?? "";
}

const ghost =
  "inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm text-[var(--paper)] transition hover:border-[var(--brass-dim)] disabled:opacity-50";
const jade =
  "inline-flex items-center gap-1.5 rounded-full bg-[var(--jade)] px-4 py-2 text-sm font-medium text-[var(--on-jade)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50";

export function ColumnMapper({
  fileText,
  headers,
  sampleRows,
  onMapped,
  onCancel,
}: {
  fileText: string;
  headers: string[];
  sampleRows: Record<string, string>[];
  onMapped: (summary: ReconcileSummary, mapping: CsvMapping) => void;
  onCancel: () => void;
}) {
  const initial = useMemo(() => {
    const cols: Partial<Record<FieldKey, string>> = {};
    for (const f of FIELDS) cols[f.key] = guess(headers, f.key);
    return cols;
  }, [headers]);

  const [cols, setCols] = useState<Partial<Record<FieldKey, string>>>(initial);
  const [sign, setSign] = useState<SignRule>(initial.action ? "action" : "signedQuantity");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function buildMapping(): CsvMapping {
    const columns: Partial<Record<FieldKey, string>> = {};
    for (const f of FIELDS) if (cols[f.key]) columns[f.key] = cols[f.key];
    return { columns, sign };
  }

  function preview() {
    setError(null);
    const mapping = buildMapping();
    start(async () => {
      const res: PreviewResult = await previewCsvMappedAction(fileText, mapping);
      if ("error" in res) setError(res.error);
      else if ("needsMapping" in res) setError("Map a date, symbol, and quantity column.");
      else onMapped(res, mapping);
    });
  }

  const ready = !!cols.date && !!cols.symbol && !!cols.quantity;

  return (
    <div>
      <p className="flex items-center gap-2 eyebrow">
        <Wand2 size={13} className="text-[var(--brass)]" /> Map your columns
      </p>
      <h3 className="mt-2 font-display text-xl">We didn&apos;t recognize this format</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Tell us which column is which. We&apos;ll remember it for next time.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-sm">
            <span className="text-[var(--muted)]">
              {f.label}
              {f.required && <span className="text-[var(--coral)]"> *</span>}
              {f.hint && <span className="text-[var(--faint)]"> · {f.hint}</span>}
            </span>
            <select
              value={cols[f.key] ?? ""}
              onChange={(e) => setCols((p) => ({ ...p, [f.key]: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm"
            >
              <option value="">— none —</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {!cols.action && (
        <label className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={sign === "signedQuantity"}
            onChange={(e) => setSign(e.target.checked ? "signedQuantity" : "action")}
          />
          Quantity is signed (negative = sell) — no separate action column
        </label>
      )}

      {sampleRows[0] && cols.symbol && (
        <p className="mt-4 rounded-lg border border-line bg-[var(--panel-2)] px-3 py-2 text-xs text-[var(--muted)] tabular">
          Preview row: {cols.date && `${sampleRows[0][cols.date] ?? ""} · `}
          {sampleRows[0][cols.symbol] ?? ""}
          {cols.quantity && ` · qty ${sampleRows[0][cols.quantity] ?? ""}`}
          {cols.amount && ` · ${sampleRows[0][cols.amount] ?? ""}`}
        </p>
      )}

      {error && <p className="mt-3 text-sm text-[var(--coral)]">{error}</p>}
      <div className="mt-6 flex gap-3">
        <button className={jade} onClick={preview} disabled={pending || !ready}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : null}
          Preview
        </button>
        <button className={ghost} onClick={onCancel} disabled={pending}>
          Back
        </button>
      </div>
    </div>
  );
}

"use client";

/**
 * Trade-import flow: pick a destination → drop an OFX/QFX file → reconcile →
 * commit. The reconcile screen is the "never import silently" gate: nothing is
 * written until the user confirms the parsed positions and reviews warnings.
 */

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, FileUp, Loader2, AlertTriangle, ArrowRight, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  previewImportAction,
  commitImportAction,
  createImportAccountAction,
  type PreviewResult,
} from "@/lib/actions-import";
import type { ReconcileSummary } from "@/lib/import/import-service";
import type { CommitResult } from "@/lib/import/import-service";
import type { CsvMapping } from "@/lib/import/csv-adapter";
import { ColumnMapper } from "@/components/import/column-mapper";

type ManualAccount = { id: string; name: string; subtype: string | null };
type Phase = "choose" | "mapping" | "preview" | "done";

const jade =
  "inline-flex items-center gap-1.5 rounded-full bg-[var(--jade)] px-4 py-2 text-sm font-medium text-[var(--on-jade)] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50";
const ghost =
  "inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm text-[var(--paper)] transition hover:border-[var(--brass-dim)] disabled:opacity-50";

export function TradeImport({ accounts }: { accounts: ManualAccount[] }) {
  const [phase, setPhase] = useState<Phase>("choose");
  const [pending, start] = useTransition();

  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? "new");
  const [newName, setNewName] = useState("");
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [summary, setSummary] = useState<ReconcileSummary | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [needsMapping, setNeedsMapping] = useState<{ headers: string[]; sampleRows: Record<string, string>[] } | null>(
    null,
  );
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setPhase("choose");
    setFileText(null);
    setFileName(null);
    setSummary(null);
    setMapping(null);
    setNeedsMapping(null);
    setResult(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onFile(file: File) {
    setError(null);
    const text = await file.text();
    setFileText(text);
    setFileName(file.name);
    start(async () => {
      const res: PreviewResult = await previewImportAction(text);
      if ("error" in res) {
        setError(res.error);
        setSummary(null);
      } else if ("needsMapping" in res) {
        setNeedsMapping({ headers: res.headers, sampleRows: res.sampleRows });
        setPhase("mapping");
      } else {
        setSummary(res);
        setPhase("preview");
      }
    });
  }

  function onImport() {
    if (!fileText) return;
    setError(null);
    start(async () => {
      let destId = accountId;
      if (destId === "new") {
        const created = await createImportAccountAction(newName || "Imported brokerage", "brokerage");
        destId = created.id;
      }
      const res = await commitImportAction({ fileText, accountId: destId, fileName, mapping: mapping ?? undefined });
      if ("error" in res) {
        setError(res.error);
      } else {
        setResult(res);
        setPhase("done");
      }
    });
  }

  // ── done ─────────────────────────────────────────────────────────────────
  if (phase === "done" && result) {
    return (
      <Card className="p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--jade)]/12">
          <CheckCircle2 className="text-[var(--jade)]" size={26} />
        </div>
        <h3 className="mt-4 font-display text-2xl">Imported {result.imported} trade{result.imported === 1 ? "" : "s"}</h3>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {result.duplicates > 0 && `${result.duplicates} already-imported skipped. `}
          {result.skipped > 0 && `${result.skipped} row(s) without a ticker skipped. `}
          Your positions and realized gains now include this history.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a href="/investments" className={jade}>
            View investments <ArrowRight size={15} />
          </a>
          <a href="/realized-gains" className={ghost}>
            Realized gains
          </a>
          <button className={ghost} onClick={reset}>
            <RotateCcw size={14} /> Import another
          </button>
        </div>
      </Card>
    );
  }

  // ── column mapping (unrecognized CSV) ──────────────────────────────────────
  if (phase === "mapping" && needsMapping && fileText) {
    return (
      <Card className="p-6 sm:p-8">
        <ColumnMapper
          fileText={fileText}
          headers={needsMapping.headers}
          sampleRows={needsMapping.sampleRows}
          onMapped={(s, m) => {
            setSummary(s);
            setMapping(m);
            setPhase("preview");
          }}
          onCancel={reset}
        />
      </Card>
    );
  }

  // ── preview / reconcile ────────────────────────────────────────────────────
  if (phase === "preview" && summary) {
    const warns = summary.warnings.filter((w) => w.level === "warn");
    const infos = summary.warnings.filter((w) => w.level === "info");
    return (
      <Card className="p-6 sm:p-8">
        <p className="eyebrow">Review before importing</p>
        <h3 className="mt-2 font-display text-2xl">
          {summary.rowsParsed} trades · {summary.symbolCount} symbols
        </h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {summary.broker ? `${summary.broker} · ` : ""}
          {summary.dateStart ?? "?"} → {summary.dateEnd ?? "?"}
          {fileName ? ` · ${fileName}` : ""}
        </p>

        {warns.length > 0 && (
          <div className="mt-5 rounded-xl border border-[var(--coral)]/40 bg-[var(--coral)]/8 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-[var(--coral)]">
              <AlertTriangle size={15} /> Incomplete history for {warns.length} symbol{warns.length === 1 ? "" : "s"}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-[var(--paper)]/90">
              {warns.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--muted)]">
              You can still import — just add the earlier trades (or a prior export) to complete the record.
            </p>
          </div>
        )}

        <div className="mt-5 max-h-72 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-sm tabular">
            <thead className="sticky top-0 bg-[var(--panel-2)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2 font-semibold">Symbol</th>
                <th className="px-4 py-2 text-right font-semibold">Net qty</th>
                <th className="px-4 py-2 text-right font-semibold">Buys</th>
                <th className="px-4 py-2 text-right font-semibold">Sells</th>
              </tr>
            </thead>
            <tbody>
              {summary.positions.map((p) => (
                <tr key={p.ticker} className="border-t border-line/60">
                  <td className="px-4 py-2 font-medium">{p.ticker}</td>
                  <td className="px-4 py-2 text-right">{p.quantity}</td>
                  <td className="px-4 py-2 text-right text-[var(--muted)]">{p.buys}</td>
                  <td className="px-4 py-2 text-right text-[var(--muted)]">{p.sells}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {infos.map((w, i) => (
          <p key={i} className="mt-2 text-xs text-[var(--muted)]">
            {w.message}
          </p>
        ))}

        {error && <p className="mt-4 text-sm text-[var(--coral)]">{error}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button className={jade} onClick={onImport} disabled={pending}>
            {pending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            Import {summary.rowsParsed} trades
          </button>
          <button className={ghost} onClick={reset} disabled={pending}>
            Choose a different file
          </button>
        </div>
      </Card>
    );
  }

  // ── choose destination + file ──────────────────────────────────────────────
  return (
    <Card className="p-6 sm:p-8">
      <p className="eyebrow">Import trade history</p>
      <h3 className="mt-2 font-display text-2xl">Bring in your broker&apos;s full record</h3>
      <p className="mt-1 max-w-lg text-sm text-[var(--muted)]">
        Export an <b>OFX/QFX</b> file (often labeled &ldquo;download for Quicken&rdquo;) or a{" "}
        <b>CSV</b> — Schwab, Fidelity, IBKR, E*Trade and Tastytrade are recognized automatically, and
        any other CSV can be mapped by hand. Cost basis and wash sales are computed from the complete
        history, not Plaid&apos;s last 24 months.
      </p>

      <label className="mt-6 block text-sm font-medium">Destination account</label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value="new">+ New brokerage account…</option>
        </select>
        {accountId === "new" && (
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Schwab Brokerage"
            className="rounded-lg border border-line bg-[var(--ink)] px-3 py-2 text-sm"
          />
        )}
      </div>

      <div className="mt-6">
        <input
          ref={fileInput}
          type="file"
          accept=".ofx,.qfx,.qbo,.csv,text/plain,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <button className={jade} onClick={() => fileInput.current?.click()} disabled={pending}>
          {pending ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          Choose an OFX / QFX / CSV file
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-[var(--coral)]">{error}</p>}
    </Card>
  );
}

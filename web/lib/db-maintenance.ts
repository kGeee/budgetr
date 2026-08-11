/**
 * Startup database maintenance.
 *
 * The app is a long-lived local SQLite database that only ever grew: nothing in
 * the repo ran VACUUM, ANALYZE, a WAL checkpoint, or any retention sweep. The
 * visible symptom was a desktop app that felt slower the longer it was owned —
 * a 31 MB file of which 29 MB was one unbounded snapshot table, and a WAL that
 * kept creeping up between restarts.
 *
 * This runs once per server boot, before the first request is served. Every
 * step is cheap on a healthy database and self-limiting on an unhealthy one.
 */

import { sqlite } from "@/db";
import { pruneIvSnapshots } from "@/lib/fixed-strike-vol";

/**
 * Reclaim the file only when there's meaningfully dead space. VACUUM rewrites
 * the whole database and takes an exclusive lock, so it's worth it after a
 * large prune and pure waste on a compact file.
 */
const VACUUM_FREELIST_RATIO = 0.2;

export type MaintenanceReport = {
  prunedIvRows: number;
  walPagesCheckpointed: number;
  vacuumed: boolean;
  freedBytes: number;
  ms: number;
};

function pragmaNumber(name: string): number {
  const value = sqlite.pragma(name, { simple: true });
  return typeof value === "number" ? value : 0;
}

function fileBytes(): number {
  return pragmaNumber("page_count") * pragmaNumber("page_size");
}

/**
 * Prune → checkpoint → analyze → (maybe) vacuum.
 *
 * Never throws: maintenance failing is not a reason to refuse to boot. A
 * locked database (another Next render worker mid-write) just means we skip a
 * cycle and try again on the next start.
 */
export function runStartupMaintenance(): MaintenanceReport {
  const started = Date.now();
  const before = fileBytes();
  const report: MaintenanceReport = {
    prunedIvRows: 0,
    walPagesCheckpointed: 0,
    vacuumed: false,
    freedBytes: 0,
    ms: 0,
  };

  try {
    report.prunedIvRows = pruneIvSnapshots();
  } catch (err) {
    console.warn("[maintenance] IV prune skipped:", (err as Error).message);
  }

  try {
    // TRUNCATE folds the WAL back into the main file and resets it to zero
    // length, rather than leaving it to grow across restarts. Returns
    // [busy, logPages, checkpointedPages].
    const rows = sqlite.pragma("wal_checkpoint(TRUNCATE)") as Array<Record<string, number>>;
    const first = rows?.[0];
    if (first) report.walPagesCheckpointed = Object.values(first)[2] ?? 0;
  } catch (err) {
    console.warn("[maintenance] WAL checkpoint skipped:", (err as Error).message);
  }

  try {
    // Refresh the planner's table statistics — without them SQLite plans
    // against whatever shape the data had long ago. `optimize` is SQLite's own
    // recommendation over a blind ANALYZE: it re-analyzes only the tables whose
    // stats have gone stale, so it costs milliseconds on a settled database
    // where a full ANALYZE of this file costs ~200ms every boot.
    sqlite.pragma("optimize");
  } catch (err) {
    console.warn("[maintenance] optimize skipped:", (err as Error).message);
  }

  try {
    const pages = pragmaNumber("page_count");
    const free = pragmaNumber("freelist_count");
    if (pages > 0 && free / pages >= VACUUM_FREELIST_RATIO) {
      sqlite.exec("VACUUM");
      report.vacuumed = true;
    }
  } catch (err) {
    console.warn("[maintenance] VACUUM skipped:", (err as Error).message);
  }

  report.freedBytes = Math.max(0, before - fileBytes());
  report.ms = Date.now() - started;
  return report;
}

/**
 * One line for the boot log. Always returns something: this is a local desktop
 * app where the owner is the operator, it prints once per start, and a silent
 * maintenance pass is indistinguishable from one that never ran.
 */
export function describeMaintenance(r: MaintenanceReport): string {
  const parts: string[] = [];
  if (r.prunedIvRows > 0) parts.push(`pruned ${r.prunedIvRows.toLocaleString()} IV rows`);
  if (r.walPagesCheckpointed > 0) parts.push(`checkpointed ${r.walPagesCheckpointed} WAL pages`);
  if (r.vacuumed) parts.push("vacuumed");
  if (r.freedBytes > 0) parts.push(`freed ${(r.freedBytes / 1024 / 1024).toFixed(1)} MB`);
  parts.push(`db ${(fileBytes() / 1024 / 1024).toFixed(1)} MB`);
  return `[maintenance] ${parts.join(" · ")} in ${r.ms}ms`;
}

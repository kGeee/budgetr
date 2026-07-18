"use client";

/** Past import batches with an undo (revert deletes exactly that batch's trades). */

import { useTransition } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { revertImportAction } from "@/lib/actions-import";

type Batch = {
  id: string;
  broker: string | null;
  fileName: string | null;
  rowsImported: number;
  dateStart: string | null;
  dateEnd: string | null;
  status: string;
  createdAt: Date;
};

export function ImportHistory({ batches }: { batches: Batch[] }) {
  const [pending, start] = useTransition();
  return (
    <Card className="p-6">
      <p className="eyebrow">Import history</p>
      <ul className="mt-4 divide-y divide-line/60">
        {batches.map((b) => {
          const reverted = b.status === "reverted";
          return (
            <li key={b.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div className={reverted ? "text-[var(--faint)] line-through" : ""}>
                <span className="font-medium">{b.broker ?? b.fileName ?? "Import"}</span>
                <span className="text-[var(--muted)]">
                  {" "}
                  · {b.rowsImported} trades
                  {b.dateStart ? ` · ${b.dateStart} → ${b.dateEnd ?? "?"}` : ""}
                </span>
              </div>
              {reverted ? (
                <span className="text-xs text-[var(--faint)]">reverted</span>
              ) : (
                <button
                  className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] transition hover:text-[var(--coral)] disabled:opacity-50"
                  disabled={pending}
                  onClick={() => start(async () => void (await revertImportAction(b.id)))}
                >
                  {pending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Undo
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

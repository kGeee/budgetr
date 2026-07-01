import { AlertTriangle, CopyMinus, TrendingUp, Timer } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { AlertsPanel } from "@/components/alerts-panel";
import { detectAnomalies, type AlertKind } from "@/lib/anomalies";

export const dynamic = "force-dynamic";

const KIND_META: { kind: AlertKind; label: string; icon: typeof AlertTriangle }[] = [
  { kind: "spike", label: "Spending spikes", icon: AlertTriangle },
  { kind: "duplicate", label: "Duplicate charges", icon: CopyMinus },
  { kind: "creep", label: "Price creep", icon: TrendingUp },
  { kind: "trial", label: "Trials ending", icon: Timer },
];

export default function InsightsPage() {
  const alerts = detectAnomalies();
  const counts = Object.fromEntries(
    KIND_META.map((m) => [m.kind, alerts.filter((a) => a.kind === m.kind).length]),
  ) as Record<AlertKind, number>;

  return (
    <div className="space-y-7">
      <PageHead title="Insights" />
      <p className="-mt-3 max-w-xl text-sm text-[var(--muted)]">
        Automatic alerts from your transactions and recurring streams — spending spikes, duplicate
        charges, subscription price creep, and free trials about to convert.
      </p>

      {/* Kind summary tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {KIND_META.map(({ kind, label, icon: Icon }) => (
          <div
            key={kind}
            className="rounded-[var(--radius)] border border-line bg-[var(--panel)] p-4"
          >
            <div className="flex items-center gap-2 text-[var(--muted)]">
              <Icon size={15} />
              <span className="eyebrow">{label}</span>
            </div>
            <p className="mt-2 font-display text-3xl tabular">{counts[kind]}</p>
          </div>
        ))}
      </div>

      <AlertsPanel alerts={alerts} />
    </div>
  );
}

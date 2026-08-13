import { AlertTriangle, CopyMinus, TrendingUp, Timer } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { AlertsPanel } from "@/components/alerts-panel";
import { detectAnomalies, type AlertKind } from "@/lib/anomalies";
import { getDataHealthAlerts } from "@/lib/data-health";

export const dynamic = "force-dynamic";

const KIND_META: { kind: AlertKind; label: string; icon: typeof AlertTriangle }[] = [
  { kind: "spike", label: "Spending spikes", icon: AlertTriangle },
  { kind: "duplicate", label: "Duplicate charges", icon: CopyMinus },
  { kind: "creep", label: "Price creep", icon: TrendingUp },
  { kind: "trial", label: "Trials ending", icon: Timer },
];

export default function InsightsPage() {
  const spending = detectAnomalies();
  const health = getDataHealthAlerts();

  const counts = Object.fromEntries(
    KIND_META.map((m) => [m.kind, spending.filter((a) => a.kind === m.kind).length]),
  ) as Record<AlertKind, number>;

  // Health first, always. A clear spending board is only reassuring if the data
  // behind it is complete, and the page previously said "Nothing unusual" while
  // a connection had been dead for seven weeks.
  const alerts = [...health, ...spending];
  const clean = alerts.length === 0;

  return (
    <div className="space-y-7">
      <PageHead
        title="Insights"
        action={
          <p className="text-sm text-[var(--muted)]">
            {clean ? (
              "Nothing needs you"
            ) : (
              <>
                <span className="text-[var(--paper)]">{alerts.length}</span>{" "}
                {alerts.length === 1 ? "thing needs" : "things need"} your attention
              </>
            )}
          </p>
        }
      />
      <p className="-mt-3 max-w-xl text-sm text-[var(--muted)]">
        Two kinds of alert: whether your data is complete enough to trust, and what your
        spending did — spikes, duplicate charges, subscription price creep, and free trials
        about to convert.
      </p>

      <AlertsPanel alerts={alerts} />

      {/* Spending detectors, and — the part that was missing — what they mean
          when they're all at zero. A clear board is a claim, so it has to say
          what was checked. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="eyebrow">Spending detectors</span>
          <span className="text-xs text-[var(--muted)]">
            {health.length > 0
              ? "Evaluated over the data present — gaps above are not covered"
              : "Evaluated over your full history"}
          </span>
        </div>
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
      </section>
    </div>
  );
}

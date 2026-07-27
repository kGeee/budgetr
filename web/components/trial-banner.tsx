import Link from "next/link";
import { Clock } from "lucide-react";

/**
 * Slim bar shown while the app is in its free-trial window, counting down the
 * days left and pointing at Settings to activate a license. Deliberately quiet —
 * informational, not a nag — and only rendered during the trial.
 */
export function TrialBanner({ daysLeft }: { daysLeft: number }) {
  const urgent = daysLeft <= 3;
  return (
    <div
      className={`flex items-center justify-center gap-2 border-b px-4 py-2 text-sm ${
        urgent
          ? "border-[color-mix(in_srgb,var(--coral)_30%,transparent)] bg-[color-mix(in_srgb,var(--coral)_10%,transparent)] text-[var(--coral)]"
          : "border-line bg-[var(--panel)] text-[var(--muted)]"
      }`}
    >
      <Clock size={14} className="shrink-0" />
      <span>
        {daysLeft} {daysLeft === 1 ? "day" : "days"} left in your free trial.
      </span>
      <Link
        href="/settings"
        className="font-medium text-[var(--brass)] underline-offset-2 hover:underline"
      >
        Activate a license
      </Link>
    </div>
  );
}

// Display formatting only — the phone never computes financial values
// (spec T5: "the phone is not a calculator"). Cents in, strings out.

export function money(cents: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(cents);
  const s = `$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (cents < 0) return `-${s}`;
  return opts.sign && cents > 0 ? `+${s}` : s;
}

export function moneyCompact(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return money(cents);
}

export function dayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const diff = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - d.getTime()) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function agoLabel(ts: number | null): string {
  if (!ts) return "never";
  const mins = Math.floor((Date.now() / 1000 - ts) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 60 / 24)}d ago`;
}

/** Prettify a category key ("cat_dining_out" → "Dining Out") for display. */
export function categoryLabel(key: string): string {
  return key
    .replace(/^cat[_-]/, "")
    .split(/[_-]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

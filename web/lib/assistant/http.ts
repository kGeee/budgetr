/**
 * Small request helpers for the assistant route. Pure, so they're testable.
 */

type HeaderSource = { headers: { get(name: string): string | null } };

/**
 * True when the request came from budgetr's own pages. Browsers send
 * `Sec-Fetch-Site` and `Origin` on a cross-site POST; either one naming another
 * site is refused. A request with neither (curl, a script on this machine) is
 * allowed, since anything that can run that can already read the database.
 */
export function isSameOrigin(req: HeaderSource): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Today's date in this machine's local calendar, YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}


// The desk flag is a DB read; never let a prerender bake in whichever value the
// setting had at build time.
export const dynamic = "force-dynamic";

// Wraps every `/investments/*` route with the section bar, above each page's own
// content (including its PageHead). The desk flag decides whether Markets,
// Options and Fundamentals appear in it; the bar is a client component, so the
// flag is read here and passed down.
export default function InvestmentsLayout({ children }: { children: React.ReactNode }) {
  return (
    // The section tabs are in the top bar now (components/topbar.tsx).
    <div className="space-y-7">{children}</div>
  );
}

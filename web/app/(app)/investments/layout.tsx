import { InvestmentsTabs } from "@/components/investments-tabs";

// Wraps every `/investments/*` route. The tab bar sits above each page's own
// content (including its PageHead) and self-hides on sub-routes it doesn't link
// to, so pages like the options scanner or import flow are unaffected. The
// `space-y-7` matches the page rhythm; when the tabs render `null` there's no
// stray gap.
export default function InvestmentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-7">
      <InvestmentsTabs />
      {children}
    </div>
  );
}

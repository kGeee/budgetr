/**
 * Standalone report shell.
 *
 * The root layout still wraps this segment (sidebar + header), but the report is
 * meant to be saved as a PDF or emailed, so the `report-page` container below is
 * the print root: the `@media print` rules in globals.css hide the app chrome
 * (`.no-print`) and reset page padding so only this content lands on paper.
 */
export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return <div className="report-page mx-auto max-w-[900px]">{children}</div>;
}

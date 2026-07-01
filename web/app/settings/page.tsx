import { Coins, Mail } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { ReportScheduleForm } from "@/components/report-schedule-form";
import { getDisplayCurrencySetting } from "@/lib/queries";
import { getReportSchedule } from "@/lib/actions-reports";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const schedule = await getReportSchedule();
  const displayCurrency = getDisplayCurrencySetting();

  return (
    <div className="space-y-7">
      <PageHead title="Settings" />

      {/* Display currency */}
      <Card>
        <CardHeader>
          <CardTitle>Display currency</CardTitle>
          <Coins size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-md text-sm text-[var(--muted)]">
            Every figure across budgetr is converted to this unit using cached ECB
            reference rates. Source currencies are preserved — this only changes how
            amounts are shown.
          </p>
          <CurrencySwitcher current={displayCurrency} />
        </div>
      </Card>

      {/* Scheduled report */}
      <Card>
        <CardHeader>
          <CardTitle>Scheduled report</CardTitle>
          <Mail size={15} className="text-[var(--brass)]" />
        </CardHeader>
        <p className="mb-6 max-w-md text-sm text-[var(--muted)]">
          Email yourself a periodic summary — totals, top vendors, category
          breakdown and net worth. Delivery is a stub for now (the report is
          rendered and logged server-side); wire up a provider to go live.
        </p>
        <ReportScheduleForm initial={schedule} />
      </Card>
    </div>
  );
}

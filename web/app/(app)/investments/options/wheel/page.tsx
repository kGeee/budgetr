import Link from "next/link";
import { ArrowLeft, Radar } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { WheelView } from "@/components/wheel-view";
import { buildWheelReport } from "@/lib/wheel";

export const dynamic = "force-dynamic";

export default async function WheelPage() {
  const report = buildWheelReport();
  return (
    <div className="space-y-7">
      <PageHead
        title="Wheel & premium"
        action={
          <div className="flex items-center gap-4">
            <Link
              href="/investments/options/scanner"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--brass)] transition-colors hover:text-[var(--paper)]"
            >
              <Radar size={15} />
              Scanner
            </Link>
            <Link
              href="/investments"
              className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
            >
              <ArrowLeft size={15} />
              Investments
            </Link>
          </div>
        }
      />
      <WheelView report={report} />
    </div>
  );
}

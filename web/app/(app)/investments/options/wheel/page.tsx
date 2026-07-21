import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
          <Link
            href="/investments"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
          >
            <ArrowLeft size={15} />
            Investments
          </Link>
        }
      />
      <WheelView report={report} />
    </div>
  );
}

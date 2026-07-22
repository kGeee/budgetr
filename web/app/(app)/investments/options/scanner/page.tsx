import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHead } from "@/components/page-head";
import { ScannerView } from "@/components/scanner-view";
import { scanWheelPuts } from "@/lib/wheel-scanner-data";

// DB (holdings/universe) stays fresh; the CBOE/Yahoo chain fetches ride the
// 30m Data Cache, so a scan is cheap to re-open within the window.
export const dynamic = "force-dynamic";
export const fetchCache = "default-cache";

export default async function ScannerPage() {
  const result = await scanWheelPuts();
  return (
    <div className="space-y-7">
      <PageHead
        title="Wheel scanner"
        action={
          <Link
            href="/investments/options/wheel"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--paper)]"
          >
            <ArrowLeft size={15} />
            Wheel
          </Link>
        }
      />
      <ScannerView result={result} />
    </div>
  );
}

"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Save as PDF" — just opens the browser print dialog. The print stylesheet in
 * globals.css strips the app chrome and this button itself (`.no-print`) so the
 * output is the bare report, which "Save as PDF" then captures.
 */
export function ReportPrintButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer size={15} />
      Save as PDF
    </Button>
  );
}

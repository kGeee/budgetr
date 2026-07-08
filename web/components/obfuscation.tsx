"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OBF_COOKIE, setHidden } from "@/lib/scale";

const ONE_YEAR = 60 * 60 * 24 * 365;

function writeCookie(hidden: boolean) {
  document.cookie = `${OBF_COOKIE}=${hidden ? "1" : "0"}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

/**
 * Seeds the client-side privacy flag during render — before any currency is
 * formatted further down the tree — so the hydrated output matches the
 * server-rendered HTML (both read the same cookie). Renders nothing.
 */
export function ScaleInit({ hidden }: { hidden: boolean }) {
  setHidden(hidden);
  return null;
}

/**
 * Privacy-mode control. Toggling writes the cookie, optimistically updates the
 * client flag, and calls router.refresh() so both the server and client
 * component trees re-render with dollar values masked (or restored).
 */
export function ObfuscationToggle({ initialHidden }: { initialHidden: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialHidden);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setHidden(next); // optimistic; the refresh re-render reads this
    writeCookie(next);
    router.refresh();
  }

  return (
    <Button
      variant={enabled ? "outline" : "ghost"}
      size="sm"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Show dollar values" : "Hide dollar values"}
      title={enabled ? "Privacy on — dollar values hidden" : "Privacy mode — hide all dollar values"}
    >
      {enabled ? <EyeOff size={15} /> : <Eye size={15} />}
      <span className="hidden sm:inline">{enabled ? "Hidden" : "Privacy"}</span>
    </Button>
  );
}

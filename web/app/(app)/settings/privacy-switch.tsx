"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OBF_COOKIE, setHidden } from "@/lib/scale";
import { Switch } from "./switch";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Privacy mode as a Settings row. Same mechanism as the top-bar control and the
 * ⌘K command: write the cookie, flip the client flag so this tick formats
 * masked, then refresh so the server tree re-renders to match.
 */
export function PrivacySwitch({ initialHidden }: { initialHidden: boolean }) {
  const router = useRouter();
  const [hidden, setHiddenState] = useState(initialHidden);

  function toggle() {
    const next = !hidden;
    setHiddenState(next);
    setHidden(next);
    document.cookie = `${OBF_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    router.refresh();
  }

  return <Switch on={hidden} label="Privacy mode" onToggle={toggle} />;
}

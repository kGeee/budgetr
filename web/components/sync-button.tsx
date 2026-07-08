"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function SyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);

  async function sync() {
    setSyncing(true);
    try {
      await fetch("/api/plaid/sync", { method: "POST" });
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={sync} disabled={syncing} aria-label="Sync accounts">
      <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
      <span className="hidden sm:inline">{syncing ? "Syncing…" : "Sync"}</span>
    </Button>
  );
}

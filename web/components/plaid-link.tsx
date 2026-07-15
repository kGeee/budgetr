"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function PlaidLink({
  variant = "primary",
  onConnected,
}: {
  variant?: ButtonProps["variant"];
  /** Called after a bank is successfully linked (e.g. the onboarding wizard
   * advances to its final step). The dashboard refresh still happens regardless. */
  onConnected?: () => void;
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch a fresh link token when the component mounts.
  useEffect(() => {
    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.link_token) setLinkToken(d.link_token);
        else setError("Could not create a link token. Add your Plaid keys to .env.local.");
      })
      .catch(() => setError("Could not reach the server."));
  }, []);

  const onSuccess = useCallback(
    async (public_token: string, metadata: PlaidLinkOnSuccessMetadata) => {
      setLoading(true);
      try {
        await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token, institution: metadata.institution }),
        });
        onConnected?.();
        router.refresh();
      } finally {
        setLoading(false);
      }
    },
    [router, onConnected],
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  if (error) {
    return (
      <p className="rounded-lg border border-[color-mix(in_srgb,var(--coral)_40%,transparent)] bg-[color-mix(in_srgb,var(--coral)_8%,transparent)] px-3 py-2 text-sm text-[var(--coral)]">
        {error}
      </p>
    );
  }

  return (
    <Button variant={variant} onClick={() => open()} disabled={!ready || !linkToken || loading}>
      <Plus size={16} strokeWidth={2.2} />
      {loading ? "Connecting…" : "Connect account"}
    </Button>
  );
}

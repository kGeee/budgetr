"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function PlaidLink() {
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
        else setError("Could not create link token. Check your Plaid keys in .env.local.");
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
        router.refresh();
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  if (error) {
    return <p className="text-sm text-[var(--negative)]">{error}</p>;
  }

  return (
    <Button onClick={() => open()} disabled={!ready || !linkToken || loading}>
      <Plus size={16} />
      {loading ? "Connecting…" : "Connect an account"}
    </Button>
  );
}

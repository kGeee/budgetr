"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { encodePairing, generateSyncKey, toBase64 } from "@budgetr/sync-crypto";
import { clearPairing, savePairing } from "@/lib/companion/store";
import { syncNow, type SyncResult } from "@/lib/companion/engine";

/**
 * Server Actions for the phone companion (spec T4 pairing/unpair).
 *
 * Pairing provisions a fresh relay channel and generates the syncKey LOCALLY —
 * the key goes into the QR the user scans, never over the network (spec §5.1).
 * Re-pairing simply provisions again: new channel, new token, new key; the old
 * channel's blobs are orphaned on the relay (rotation, spec §T6).
 */

const RELAY_URL = process.env.COMPANION_RELAY_URL ?? "https://budgetr-relay.fly.dev";

export async function pairPhone(): Promise<{ qrSvg: string }> {
  const res = await fetch(`${RELAY_URL}/v1/channels`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`relay provisioning failed (${res.status})`);
  const { channelId, channelToken } = (await res.json()) as { channelId: string; channelToken: string };

  const syncKey = toBase64(generateSyncKey());
  savePairing({ relayUrl: RELAY_URL, channelId, channelToken, syncKey });

  const payload = encodePairing({ relayUrl: RELAY_URL, channelId, channelToken, syncKey, v: 1 });
  const qrSvg = await QRCode.toString(payload, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

  // Push the first summary immediately so the phone has data the moment it scans.
  void syncNow().catch(() => {});

  revalidatePath("/settings");
  return { qrSvg };
}

export async function unpairPhone(): Promise<void> {
  clearPairing();
  revalidatePath("/settings");
}

export async function syncPhoneNow(): Promise<SyncResult> {
  const result = await syncNow();
  revalidatePath("/settings");
  return result;
}

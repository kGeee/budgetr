// Pairing material in the iOS Keychain via expo-secure-store (spec §5.1).
// The syncKey never touches plain storage, logs, or the network — it arrived
// by scanning the desktop's QR and lives only here.

import * as SecureStore from "expo-secure-store";
import type { PairingMaterial } from "@budgetr/sync-crypto";

const KEY = "companion.pairing";

export async function loadMaterial(): Promise<PairingMaterial | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PairingMaterial;
  } catch {
    return null;
  }
}

export async function saveMaterial(m: PairingMaterial): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(m));
}

export async function clearMaterial(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

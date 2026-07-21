// Offline cache: the last good decrypted Summary, its ETag, the pending op
// queue, and a stable device id. AsyncStorage over MMKV (spec DECISION
// revisited): it's one small JSON blob and AsyncStorage runs in Expo Go —
// no dev-client build needed to iterate.
//
// The cache holds DECRYPTED data on-device. That's the product: the phone is
// trusted glass. It never leaves the app sandbox.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Op, Summary } from "@budgetr/core";
import { uuid4 } from "./uuid";

const K = {
  summary: "companion.summary",
  etag: "companion.etag",
  pending: "companion.pendingOps",
  lastSyncAt: "companion.lastSyncAt",
  deviceId: "companion.deviceId",
} as const;

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadCachedSummary(): Promise<{ summary: Summary; etag: string | null; lastSyncAt: number | null } | null> {
  const summary = await getJson<Summary>(K.summary);
  if (!summary) return null;
  return {
    summary,
    etag: await AsyncStorage.getItem(K.etag),
    lastSyncAt: Number(await AsyncStorage.getItem(K.lastSyncAt)) || null,
  };
}

export async function saveCachedSummary(summary: Summary, etag: string | null): Promise<void> {
  await AsyncStorage.setItem(K.summary, JSON.stringify(summary));
  if (etag) await AsyncStorage.setItem(K.etag, etag);
  await AsyncStorage.setItem(K.lastSyncAt, String(Math.floor(Date.now() / 1000)));
}

export async function touchLastSync(): Promise<void> {
  await AsyncStorage.setItem(K.lastSyncAt, String(Math.floor(Date.now() / 1000)));
}

export async function loadPendingOps(): Promise<Op[]> {
  return (await getJson<Op[]>(K.pending)) ?? [];
}

export async function savePendingOps(ops: Op[]): Promise<void> {
  await AsyncStorage.setItem(K.pending, JSON.stringify(ops));
}

export async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(K.deviceId);
  if (!id) {
    id = `dev_${uuid4()}`;
    await AsyncStorage.setItem(K.deviceId, id);
  }
  return id;
}

export async function clearCache(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(K));
}

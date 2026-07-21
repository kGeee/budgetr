// Pairing payload: the desktop renders encodePairing(...) as a QR code, the
// phone scans and decodePairing(...)s it. The syncKey therefore never transits
// any network — the devices exchange it on-screen (spec §5.1). State that in
// the pairing UI.

import { fromBase64, fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from './bytes.js';
import { SYNC_KEY_BYTES } from './envelope.js';

export const PAIRING_VERSION = 1;
// Prefix makes QR contents self-identifying and versionable at the container
// level (the JSON inside carries `v` as well).
const PAIRING_PREFIX = 'budgetr1.';

export interface PairingPayload {
  relayUrl: string;
  channelId: string;
  channelToken: string;
  syncKey: string; // base64(32 bytes)
  v: 1;
}

/** What both devices persist in OS secure storage after pairing. */
export interface PairingMaterial {
  relayUrl: string;
  channelId: string;
  channelToken: string;
  syncKey: string; // base64(32 bytes) — decode at use, never log
}

export interface KeyStore {
  load(): Promise<PairingMaterial | null>;
  save(m: PairingMaterial): Promise<void>;
  clear(): Promise<void>;
}

export class PairingDecodeError extends Error {
  constructor(message: string) {
    super(`invalid pairing payload: ${message}`);
    this.name = 'PairingDecodeError';
  }
}

export function encodePairing(p: PairingPayload): string {
  validatePairing(p);
  return PAIRING_PREFIX + toBase64Url(utf8Encode(JSON.stringify(p)));
}

export function decodePairing(s: string): PairingPayload {
  if (typeof s !== 'string' || !s.startsWith(PAIRING_PREFIX)) {
    throw new PairingDecodeError('not a budgetr pairing code');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(fromBase64Url(s.slice(PAIRING_PREFIX.length))));
  } catch {
    throw new PairingDecodeError('malformed encoding');
  }
  validatePairing(parsed);
  return parsed;
}

function validatePairing(p: unknown): asserts p is PairingPayload {
  if (typeof p !== 'object' || p === null) throw new PairingDecodeError('not an object');
  const r = p as Record<string, unknown>;
  if (r.v !== PAIRING_VERSION) throw new PairingDecodeError(`unsupported version ${String(r.v)}`);
  for (const field of ['relayUrl', 'channelId', 'channelToken', 'syncKey'] as const) {
    if (typeof r[field] !== 'string' || r[field].length === 0) {
      throw new PairingDecodeError(`missing ${field}`);
    }
  }
  if (!/^https?:\/\//.test(r.relayUrl as string)) throw new PairingDecodeError('relayUrl must be http(s)');
  let key: Uint8Array;
  try {
    key = fromBase64(r.syncKey as string);
  } catch {
    throw new PairingDecodeError('syncKey is not base64');
  }
  if (key.length !== SYNC_KEY_BYTES) throw new PairingDecodeError('syncKey must decode to 32 bytes');
}

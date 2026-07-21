// Envelope encryption for everything crossing the relay (spec §5.2).
//
// Algorithm: NaCl secretbox = XSalsa20-Poly1305, via tweetnacl. tweetnacl is
// byte-compatible with libsodium's crypto_secretbox_easy (verified by the
// cross-implementation test against libsodium-wrappers) and is pure JS, so the
// same code runs in Node, Electron, and React Native/Expo Go with no native
// module. A future Swift client uses swift-sodium's SecretBox against the same
// wire format — see test/vectors.json for frozen test vectors.
//
// Threat model (spec §5.3): the relay sees ciphertext, sizes, timing, and
// channel ids — never contents. On any auth failure we discard the whole
// message; partial plaintext is never returned.

import nacl from 'tweetnacl';
import { fromBase64, toBase64, utf8Decode, utf8Encode } from './bytes.js';

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALG = 'xsalsa20-poly1305';
export const SYNC_KEY_BYTES = 32;
export const NONCE_BYTES = 24;

export interface Envelope {
  v: 1;
  alg: 'xsalsa20-poly1305';
  nonce: string; // base64, 24 random bytes, fresh per message
  ct: string; // base64 ciphertext of JSON.stringify(payload)
}

/** Authentication failed: wrong key or tampered ciphertext. Discard the message. */
export class EnvelopeTamperError extends Error {
  constructor() {
    super('envelope failed authentication — wrong key or tampered ciphertext');
    this.name = 'EnvelopeTamperError';
  }
}

/** Envelope written by a newer (or unknown) format than this reader supports. */
export class EnvelopeVersionError extends Error {
  constructor(seen: unknown) {
    super(`unsupported envelope version/alg: ${JSON.stringify(seen)}`);
    this.name = 'EnvelopeVersionError';
  }
}

function assertKey(syncKey: Uint8Array): void {
  if (!(syncKey instanceof Uint8Array) || syncKey.length !== SYNC_KEY_BYTES) {
    throw new TypeError(`syncKey must be ${SYNC_KEY_BYTES} bytes`);
  }
}

export function generateSyncKey(): Uint8Array {
  return nacl.randomBytes(SYNC_KEY_BYTES);
}

export function seal(payload: unknown, syncKey: Uint8Array): Envelope {
  assertKey(syncKey);
  const nonce = nacl.randomBytes(NONCE_BYTES);
  return sealWithNonce(payload, syncKey, nonce);
}

// Deterministic core, exported for the cross-implementation vector tests only.
// Production callers must use seal() — nonce reuse breaks XSalsa20-Poly1305.
export function sealWithNonce(payload: unknown, syncKey: Uint8Array, nonce: Uint8Array): Envelope {
  assertKey(syncKey);
  if (nonce.length !== NONCE_BYTES) throw new TypeError(`nonce must be ${NONCE_BYTES} bytes`);
  const ct = nacl.secretbox(utf8Encode(JSON.stringify(payload)), nonce, syncKey);
  return { v: 1, alg: ENVELOPE_ALG, nonce: toBase64(nonce), ct: toBase64(ct) };
}

export function open<T>(env: Envelope, syncKey: Uint8Array): T {
  assertKey(syncKey);
  if (typeof env !== 'object' || env === null) throw new EnvelopeVersionError(env);
  if (env.v !== ENVELOPE_VERSION || env.alg !== ENVELOPE_ALG) {
    throw new EnvelopeVersionError({ v: env.v, alg: env.alg });
  }
  let nonce: Uint8Array;
  let ct: Uint8Array;
  try {
    nonce = fromBase64(env.nonce);
    ct = fromBase64(env.ct);
  } catch {
    throw new EnvelopeTamperError();
  }
  if (nonce.length !== NONCE_BYTES) throw new EnvelopeTamperError();
  const plaintext = nacl.secretbox.open(ct, nonce, syncKey);
  if (!plaintext) throw new EnvelopeTamperError();
  return JSON.parse(utf8Decode(plaintext)) as T;
}

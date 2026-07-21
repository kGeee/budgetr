// The cross-platform gate from spec T2: our tweetnacl-based envelope must be
// byte-identical to libsodium's crypto_secretbox_easy. This is what lets the
// desktop, an Expo phone, and a future swift-sodium client share one wire
// format. If this file fails, STOP — do not ship sync until it passes.

// libsodium-wrappers' ESM dist is broken (references a libsodium.mjs it does
// not ship), so load the CJS entry explicitly.
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { fromBase64, open, sealWithNonce, toBase64, utf8Encode } from '../src/index.js';
import vectors from './vectors.json';

const _sodium = createRequire(import.meta.url)('libsodium-wrappers') as typeof import('libsodium-wrappers');

let sodium: typeof _sodium;
beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium;
});

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, i) => i));
const NONCE = new Uint8Array(Array.from({ length: 24 }, (_, i) => 100 + i));

describe('cross-implementation compatibility (tweetnacl ↔ libsodium)', () => {
  it('sealWithNonce ciphertext === libsodium crypto_secretbox_easy', () => {
    for (const payload of [{ hello: 'wörld ☕', cents: -1250 }, { a: [] }, 'str']) {
      const env = sealWithNonce(payload, KEY, NONCE);
      const expected = sodium.crypto_secretbox_easy(utf8Encode(JSON.stringify(payload)), NONCE, KEY);
      expect(env.ct).toBe(toBase64(expected));
    }
  });

  it('open() decrypts an envelope produced by libsodium', () => {
    const payload = { from: 'libsodium', merchant: '東京 Coffee' };
    const ct = sodium.crypto_secretbox_easy(utf8Encode(JSON.stringify(payload)), NONCE, KEY);
    const decrypted = open<typeof payload>(
      { v: 1, alg: 'xsalsa20-poly1305', nonce: toBase64(NONCE), ct: toBase64(ct) },
      KEY,
    );
    expect(decrypted).toEqual(payload);
  });

  it('libsodium decrypts an envelope produced by seal()', () => {
    const payload = { from: 'tweetnacl' };
    const env = sealWithNonce(payload, KEY, NONCE);
    const pt = sodium.crypto_secretbox_open_easy(fromBase64(env.ct), fromBase64(env.nonce), KEY);
    expect(JSON.parse(sodium.to_string(pt))).toEqual(payload);
  });

  it('matches the frozen vectors (future Swift clients test against these too)', () => {
    for (const v of vectors.vectors) {
      const env = sealWithNonce(v.payload, fromBase64(v.key), fromBase64(v.nonce));
      expect(env.ct).toBe(v.ct);
    }
  });
});

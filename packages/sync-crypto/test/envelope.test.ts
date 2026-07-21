import { describe, expect, it } from 'vitest';
import {
  EnvelopeTamperError,
  EnvelopeVersionError,
  fromBase64,
  generateSyncKey,
  open,
  seal,
  toBase64,
  type Envelope,
} from '../src/index.js';

const key = () => new Uint8Array(Array.from({ length: 32 }, (_, i) => i));

const PAYLOADS: unknown[] = [
  { hello: 'world' },
  { merchant: 'Café Zoë ☕️ — 東京', cents: -1250 },
  { empty: [], nested: { a: [1, 2, 3], b: null } },
  [],
  'just a string',
  { big: 'x'.repeat(50_000) },
];

describe('seal/open', () => {
  it('round-trips varied payloads including unicode and empty arrays', () => {
    for (const p of PAYLOADS) {
      expect(open(seal(p, key()), key())).toEqual(p);
    }
  });

  it('uses a fresh nonce per message — same payload never repeats ciphertext', () => {
    const a = seal({ x: 1 }, key());
    const b = seal({ x: 1 }, key());
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ct).not.toBe(b.ct);
  });

  it('wrong key → EnvelopeTamperError', () => {
    const env = seal({ x: 1 }, key());
    const wrong = generateSyncKey();
    expect(() => open(env, wrong)).toThrow(EnvelopeTamperError);
  });

  it('a single flipped ciphertext byte → EnvelopeTamperError, never partial data', () => {
    const env = seal({ secret: 'net worth' }, key());
    const ct = fromBase64(env.ct);
    ct[5]! ^= 0x01;
    expect(() => open({ ...env, ct: toBase64(ct) }, key())).toThrow(EnvelopeTamperError);
  });

  it('bumped version or unknown alg → EnvelopeVersionError', () => {
    const env = seal({ x: 1 }, key());
    expect(() => open({ ...env, v: 2 } as unknown as Envelope, key())).toThrow(EnvelopeVersionError);
    expect(() => open({ ...env, alg: 'aes-gcm' } as unknown as Envelope, key())).toThrow(EnvelopeVersionError);
  });

  it('garbage base64 in nonce/ct → EnvelopeTamperError, no crash', () => {
    const env = seal({ x: 1 }, key());
    expect(() => open({ ...env, ct: '!!not base64!!' }, key())).toThrow(EnvelopeTamperError);
    expect(() => open({ ...env, nonce: 'AAAA' }, key())).toThrow(EnvelopeTamperError);
  });

  it('rejects malformed keys', () => {
    expect(() => seal({ x: 1 }, new Uint8Array(16))).toThrow(TypeError);
  });

  it('generateSyncKey: 32 bytes, non-repeating', () => {
    const a = generateSyncKey();
    expect(a).toHaveLength(32);
    expect(toBase64(a)).not.toBe(toBase64(generateSyncKey()));
  });
});

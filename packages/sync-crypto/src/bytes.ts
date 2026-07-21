// Pure-JS byte helpers. Deliberately no Buffer (Node-only) and no
// TextEncoder/atob (present in Node + modern Hermes, but pinning to pure JS
// removes any doubt about Expo Go / older Hermes). Blobs are ≤256 KB, so
// performance is irrelevant.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64[i]!] = i;

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '=';
    out += i + 2 < bytes.length ? B64[c & 63]! : '=';
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  if (typeof s !== 'string' || /[^A-Za-z0-9+/=]/.test(s) || s.length % 4 !== 0) {
    throw new TypeError('invalid base64');
  }
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const len = (s.length / 4) * 3 - pad;
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      (B64_LOOKUP[s[i]!]! << 18) |
      (B64_LOOKUP[s[i + 1]!]! << 12) |
      ((B64_LOOKUP[s[i + 2]!] ?? 0) << 6) |
      (B64_LOOKUP[s[i + 3]!] ?? 0);
    if (o < len) out[o++] = n >> 16;
    if (o < len) out[o++] = (n >> 8) & 0xff;
    if (o < len) out[o++] = n & 0xff;
  }
  return out;
}

// base64url (RFC 4648 §5, no padding) — used for the QR pairing string.
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  if (typeof s !== 'string' || /[^A-Za-z0-9_-]/.test(s)) throw new TypeError('invalid base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if (b0 < 0xe0) {
      cp = ((b0 & 31) << 6) | (bytes[i + 1]! & 63);
      i += 2;
    } else if (b0 < 0xf0) {
      cp = ((b0 & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63);
      i += 3;
    } else {
      cp = ((b0 & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63);
      i += 4;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

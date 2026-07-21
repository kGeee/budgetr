# packages/ — budgetr companion shared code

Shared packages for the phone-companion sync layer (see the companion spec).
Plain standalone npm packages — deliberately **not** a pnpm/Turborepo
conversion; `web/` stays untouched until T4 wires it up via a `file:`
dependency.

| Package | What | Status |
|---|---|---|
| `core/` | Wire contracts (`Summary`, `OutboxBatch`, `Op`), validators, `buildSummary` | T1 ✅ contracts + invariants; desktop read-model wiring lands with T4 |
| `sync-crypto/` | `seal`/`open` envelope (XSalsa20-Poly1305 secretbox), pairing QR payload, `KeyStore` interface | T2 ✅ |
| `relay/` | Content-blind Fastify relay (spec §6): channels, summary + ETag, outbox + idempotency, rate limit, TTL sweep. Dockerfile + fly.toml | T3 ✅ code; Fly deploy pending `fly auth login` |

## Design notes

- **Crypto is tweetnacl, not libsodium.** tweetnacl is pure JS and
  byte-compatible with libsodium `crypto_secretbox_easy` (proven by
  `sync-crypto/test/cross-impl.test.ts`), so the identical code runs in Node,
  Electron, and Expo Go with zero native modules. `test/vectors.json` holds
  frozen libsodium-generated vectors — a future Swift client (swift-sodium
  SecretBox) must reproduce them exactly. Do not regenerate them casually.
- **React Native note:** tweetnacl needs `crypto.getRandomValues`; the Expo app
  must import `expo-crypto`/`react-native-get-random-values` polyfill before
  first `seal()`/`generateSyncKey()` call.
- **Money is integer cents, time is unix seconds (UTC), everywhere.**
  `buildSummary` rounds/rejects at generation; validators reject floats at the
  trust edge.
- Positions on the wire carry **only** `symbol` + `cents` — the validator
  rejects any extra field on a position (basis/greeks/lots must be
  unreconstructable from the relay).

## Commands (per package)

```
npm install
npm test        # vitest
npm run typecheck
npm run build   # emits dist/ for consumers
```

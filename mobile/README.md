# budgetr companion (iOS)

The phone half of budgetr sync: a glanceable, end-to-end-encrypted view of the
summary your Mac publishes, plus two edits (recategorize a transaction, dismiss
an alert) that queue in an outbox until the Mac applies them.

The phone is trusted glass, not a calculator: it renders exactly what the
`Summary` contract carries and computes no financial values. Cost basis, lots,
and greeks never reach this device by design.

## Run it (Expo Go — no build needed)

```sh
cd mobile
npm install
npx expo start
```

Scan the Metro QR with the Expo Go app, then pair: on your Mac, budgetr →
Settings → Phone companion → Pair phone, and scan that QR from the app's
pairing screen (or paste the `budgetr1.…` string when using a simulator).

## Architecture

- `src/state/companion.tsx` — the one provider: pairing gate, cached summary,
  optimistic edits, refresh on foreground/pull.
- `src/sync/client.ts` — the protocol: flush outbox (Idempotency-Key), GET
  summary with If-None-Match, decrypt (`@budgetr/sync-crypto`), validate
  (`@budgetr/core`), prune confirmed ops via `Summary.appliedOpIds`.
- `src/sync/material.ts` — pairing material in the iOS Keychain
  (expo-secure-store). `src/sync/cache.ts` — decrypted summary + pending ops in
  AsyncStorage (deviation from the spec's MMKV: one small blob, and
  AsyncStorage runs in Expo Go).
- Screens (exactly four, spec T5): Home, Budgets, Activity, Holdings.

Failure modes are states, not crashes: offline/tamper shows the last good
cache with a banner; a newer summary version shows "update required".

## Crypto notes

`react-native-get-random-values` is imported first in `src/app/_layout.tsx` —
tweetnacl (inside `@budgetr/sync-crypto`) needs `crypto.getRandomValues` for
nonces and op ids. The envelope format is byte-compatible with libsodium
(`packages/sync-crypto/test/vectors.json` is the cross-client proof).

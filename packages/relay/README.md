# @budgetr/relay

The companion's store-and-forward relay (spec §6): a dumb, content-blind
Fastify service that authorizes by channel token and moves opaque encrypted
envelopes between the desktop and the phone. It **cannot decrypt anything**
(no keys ever reach it) and **never logs blob contents** — log lines carry
only channelId, method, path, status, and byte count. There is a test that
enforces this (`test/relay.test.ts`, "log audit").

## Endpoints

| Route | Purpose |
|---|---|
| `POST /v1/channels` | Provision: returns `{channelId, channelToken}`. Called once by the desktop during pairing. |
| `PUT  /v1/channels/:id/summary` | Replace the latest summary envelope (≤256 KB). Strong `ETag = sha256(ct)`. |
| `GET  /v1/channels/:id/summary` | Fetch latest; honors `If-None-Match` → `304`. `404` before first PUT. |
| `POST /v1/channels/:id/outbox` | Append an encrypted OutboxBatch → `{seq}`. `Idempotency-Key: <batchId>` dedupes. |
| `GET  /v1/channels/:id/outbox?after=<seq>` | Pending batches, ascending. Desktop polls this. |
| `DELETE /v1/channels/:id/outbox?through=<seq>` | Ack: delete `seq ≤ through`. |
| `GET /healthz` | Liveness. |

Auth: `Authorization: Bearer <channelToken>` on all `/v1/channels/:id/*`
routes. Missing → `401`; wrong token, cross-channel token, or unknown channel
→ `403` (indistinguishable on purpose). Tokens are stored as SHA-256 hashes;
the plaintext exists only in the provisioning response.

Per-channel write budget: 60/min (PUT summary + POST outbox), `429` +
`Retry-After` beyond it. Unacked outbox batches are swept after 30 days.

## Config (env)

`PORT` (8080) · `DB_PATH` (`relay.db`; `/data/relay.db` in Docker) ·
`WRITES_PER_MIN` (60) · `OUTBOX_TTL_DAYS` (30)

## Deploy (Fly.io — the hosted relay)

```sh
fly launch --no-deploy --copy-config --name budgetr-relay
fly volumes create relay_data --size 1
fly deploy
```

One always-on `shared-cpu-1x` machine (~$3/mo) + a 1 GB volume for SQLite.

## Self-host (the same image)

```sh
docker build -t budgetr/relay .
docker run -d -v relay-data:/data -p 8080:8080 budgetr/relay
```

Put it behind your own TLS (Caddy, Traefik, a tailnet). The desktop's pairing
QR embeds whatever `relayUrl` you configure, so a self-hosted relay needs no
code changes anywhere.

## Storage

`src/storage.ts` defines the `RelayStorage` adapter interface; the shipped
impl is a single SQLite file (WAL). Channels, latest-only summaries, and the
outbox queue (`seq` = autoincrement rowid, so it's monotonic per channel).
Swapping in Postgres/object storage later touches nothing in `src/app.ts`.

## Known gap (fine for v1, revisit before strangers use it)

`POST /v1/channels` is unauthenticated and not rate-limited — anyone who can
reach the relay can provision a channel. Acceptable while the relay is
single-user/private; add an invite token or per-IP limit before opening it up.

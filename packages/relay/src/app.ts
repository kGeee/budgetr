// The relay app (spec §6): a dumb, content-blind store. It authorizes by
// channel token and moves opaque envelopes. It must never be able to decrypt
// anything and must never log blob contents.
//
// Threat model (spec §5.3): this service sees ciphertext, blob sizes, timing,
// channelId, and channelToken. Nothing else. Logging is restricted to
// channelId, method, status, and byte length — never ct, never nonce, never
// tokens. Do not add fields to log lines without checking that rule.
//
// The relay deliberately does NOT import @budgetr/core contract types
// (spec §3): payloads are opaque. Only the envelope *container* shape is
// checked structurally, so garbage is rejected with a clean 4xx.

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { RelayStorage } from './storage.js';

export const MAX_BODY_BYTES = 256 * 1024; // spec §6: max body 256 KB
export const DEFAULT_WRITES_PER_MIN = 60;

export interface RelayAppOptions {
  storage: RelayStorage;
  /** Per-channel write budget per minute (PUT summary + POST outbox). */
  writesPerMin?: number;
  /** Injectable clock (unix seconds) for tests. */
  now?: () => number;
  /** Structured log sink. Default: JSON lines to stdout. Never receives blob contents. */
  log?: (line: Record<string, unknown>) => void;
}

function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/** Structural check of the envelope container only — contents stay opaque. */
function isEnvelopeShaped(x: unknown): x is { v: 1; alg: string; nonce: string; ct: string } {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const e = x as Record<string, unknown>;
  return e.v === 1 && typeof e.alg === 'string' && typeof e.nonce === 'string' && typeof e.ct === 'string';
}

export function buildApp(opts: RelayAppOptions): FastifyInstance {
  const { storage } = opts;
  const writesPerMin = opts.writesPerMin ?? DEFAULT_WRITES_PER_MIN;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const log = opts.log ?? ((line: Record<string, unknown>) => console.log(JSON.stringify(line)));

  const app = Fastify({ bodyLimit: MAX_BODY_BYTES, logger: false });

  // ── access log: method, path, status, request bytes. Nothing else. ──
  app.addHook('onResponse', (req, reply, done) => {
    log({
      t: now(),
      method: req.method,
      path: req.url.split('?')[0], // query params carry only seq numbers, but strip anyway
      status: reply.statusCode,
      bytes: Number(req.headers['content-length'] ?? 0),
    });
    done();
  });

  // Malformed input must land as clean 4xx, never 5xx (spec T3 fuzz criterion).
  app.setErrorHandler((err: unknown, _req, reply) => {
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    // name only — an error message could echo body fragments into the log
    if (status === 500) log({ t: now(), error: err instanceof Error ? err.name : 'unknown' });
    void reply.status(status).send({ error: status === 500 ? 'internal' : 'bad request' });
  });

  app.get('/healthz', async () => ({ ok: true }));

  // ── provisioning (called once by the desktop during pairing) ──
  app.post('/v1/channels', async (_req, reply) => {
    const channelId = 'ch_' + randomBytes(12).toString('base64url');
    const channelToken = 'tok_' + randomBytes(32).toString('base64url');
    storage.createChannel(channelId, sha256(channelToken), now());
    return reply.status(201).send({ channelId, channelToken });
  });

  // ── per-channel write rate limiting (fixed 60 s window) ──
  const windows = new Map<string, { start: number; count: number }>();
  function takeWriteBudget(channelId: string, reply: FastifyReply): boolean {
    const t = now();
    const w = windows.get(channelId);
    if (!w || t - w.start >= 60) {
      windows.set(channelId, { start: t, count: 1 });
      return true;
    }
    if (w.count >= writesPerMin) {
      void reply.status(429).header('Retry-After', String(w.start + 60 - t)).send({ error: 'rate limited' });
      return false;
    }
    w.count += 1;
    return true;
  }

  // ── authorized channel routes ──
  app.register(
    async (scope) => {
      scope.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
        const { channelId } = req.params as { channelId: string };
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
          return reply.status(401).send({ error: 'missing bearer token' });
        }
        const presented = sha256(auth.slice('Bearer '.length));
        const stored = storage.getTokenHash(channelId);
        // Unknown channel and wrong token are indistinguishable: 403 for both.
        if (!stored || !timingSafeEqual(presented, stored)) {
          return reply.status(403).send({ error: 'forbidden' });
        }
      });

      scope.put('/summary', async (req, reply) => {
        const { channelId } = req.params as { channelId: string };
        if (!isEnvelopeShaped(req.body)) return reply.status(400).send({ error: 'not an envelope' });
        if (!takeWriteBudget(channelId, reply)) return reply;
        const etag = `"${sha256(req.body.ct).toString('hex')}"`; // strong ETag = hash(ct)
        storage.putSummary(channelId, JSON.stringify(req.body), etag, now());
        return reply.status(204).header('ETag', etag).send();
      });

      scope.get('/summary', async (req, reply) => {
        const { channelId } = req.params as { channelId: string };
        const stored = storage.getSummary(channelId);
        if (!stored) return reply.status(404).send({ error: 'no summary yet' });
        if (req.headers['if-none-match'] === stored.etag) {
          return reply.status(304).header('ETag', stored.etag).send();
        }
        return reply
          .status(200)
          .header('ETag', stored.etag)
          .type('application/json')
          .send(stored.envelopeJson);
      });

      scope.post('/outbox', async (req, reply) => {
        const { channelId } = req.params as { channelId: string };
        if (!isEnvelopeShaped(req.body)) return reply.status(400).send({ error: 'not an envelope' });
        if (!takeWriteBudget(channelId, reply)) return reply;
        const idemHeader = req.headers['idempotency-key'];
        const idemKey = typeof idemHeader === 'string' && idemHeader.length > 0 ? idemHeader : null;
        const { seq } = storage.appendOutbox(channelId, idemKey, JSON.stringify(req.body), now());
        return reply.status(201).send({ seq });
      });

      scope.get('/outbox', async (req, reply) => {
        const { channelId } = req.params as { channelId: string };
        const raw = (req.query as Record<string, string | undefined>).after ?? '0';
        const after = Number(raw);
        if (!Number.isSafeInteger(after) || after < 0) return reply.status(400).send({ error: 'bad after' });
        const rows = storage.listOutbox(channelId, after);
        return rows.map((r) => ({ seq: r.seq, env: JSON.parse(r.envelopeJson) as unknown }));
      });

      scope.delete('/outbox', async (req, reply) => {
        const { channelId } = req.params as { channelId: string };
        const raw = (req.query as Record<string, string | undefined>).through;
        const through = Number(raw);
        if (raw === undefined || !Number.isSafeInteger(through) || through < 0) {
          return reply.status(400).send({ error: 'bad through' });
        }
        storage.deleteOutboxThrough(channelId, through);
        return reply.status(204).send();
      });
    },
    { prefix: '/v1/channels/:channelId' },
  );

  return app;
}

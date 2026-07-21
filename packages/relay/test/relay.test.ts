import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { SqliteStorage } from '../src/storage.js';

let app: FastifyInstance;
let storage: SqliteStorage;
let logs: Array<Record<string, unknown>>;
let clock: { t: number };

const envelope = (tag = 'x') => ({
  v: 1,
  alg: 'xsalsa20-poly1305',
  nonce: 'Tm9uY2VOb25jZU5vbmNlTm9uY2VOb25jZU5vbmNl',
  ct: `Q2lwaGVydGV4dC${tag}==`,
});

async function provision() {
  const res = await app.inject({ method: 'POST', url: '/v1/channels' });
  expect(res.statusCode).toBe(201);
  return res.json() as { channelId: string; channelToken: string };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(() => {
  storage = new SqliteStorage(':memory:');
  logs = [];
  clock = { t: 1_750_000_000 };
  app = buildApp({ storage, writesPerMin: 5, now: () => clock.t, log: (l) => logs.push(l) });
});

afterEach(async () => {
  await app.close();
  storage.close();
});

describe('auth', () => {
  it('401 without a bearer token, 403 on wrong token, 403 on cross-channel token', async () => {
    const a = await provision();
    const b = await provision();

    const noAuth = await app.inject({ method: 'GET', url: `/v1/channels/${a.channelId}/summary` });
    expect(noAuth.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'GET',
      url: `/v1/channels/${a.channelId}/summary`,
      headers: auth('tok_definitely-wrong'),
    });
    expect(wrong.statusCode).toBe(403);

    const crossed = await app.inject({
      method: 'GET',
      url: `/v1/channels/${a.channelId}/summary`,
      headers: auth(b.channelToken),
    });
    expect(crossed.statusCode).toBe(403);

    const unknownChannel = await app.inject({
      method: 'GET',
      url: '/v1/channels/ch_nonexistent/summary',
      headers: auth(a.channelToken),
    });
    expect(unknownChannel.statusCode).toBe(403);
  });
});

describe('summary', () => {
  it('404 before any summary; PUT then GET round-trips with a strong ETag', async () => {
    const c = await provision();
    const url = `/v1/channels/${c.channelId}/summary`;

    expect((await app.inject({ method: 'GET', url, headers: auth(c.channelToken) })).statusCode).toBe(404);

    const put = await app.inject({ method: 'PUT', url, headers: auth(c.channelToken), payload: envelope() });
    expect(put.statusCode).toBe(204);
    const etag = put.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    const get = await app.inject({ method: 'GET', url, headers: auth(c.channelToken) });
    expect(get.statusCode).toBe(200);
    expect(get.headers.etag).toBe(etag);
    expect(get.json()).toEqual(envelope());
  });

  it('If-None-Match on the current ETag → 304; stale ETag → 200', async () => {
    const c = await provision();
    const url = `/v1/channels/${c.channelId}/summary`;
    const put = await app.inject({ method: 'PUT', url, headers: auth(c.channelToken), payload: envelope() });
    const etag = put.headers.etag as string;

    const notModified = await app.inject({
      method: 'GET',
      url,
      headers: { ...auth(c.channelToken), 'if-none-match': etag },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.body).toBe('');

    const stale = await app.inject({
      method: 'GET',
      url,
      headers: { ...auth(c.channelToken), 'if-none-match': '"deadbeef"' },
    });
    expect(stale.statusCode).toBe(200);
  });

  it('retention is latest-only: repeated PUTs never grow storage', async () => {
    const c = await provision();
    const url = `/v1/channels/${c.channelId}/summary`;
    for (let i = 0; i < 5; i++) {
      clock.t += 61; // stay under the write budget
      const res = await app.inject({ method: 'PUT', url, headers: auth(c.channelToken), payload: envelope(`v${i}`) });
      expect(res.statusCode).toBe(204);
    }
    expect(storage.countSummaries()).toBe(1);
    const get = await app.inject({ method: 'GET', url, headers: auth(c.channelToken) });
    expect(get.json()).toEqual(envelope('v4'));
  });
});

describe('outbox', () => {
  it('POST assigns ascending seq; GET ?after= pages; DELETE ?through= acks', async () => {
    const c = await provision();
    const base = `/v1/channels/${c.channelId}/outbox`;

    const seqs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'POST', url: base, headers: auth(c.channelToken), payload: envelope(`b${i}`) });
      expect(res.statusCode).toBe(201);
      seqs.push((res.json() as { seq: number }).seq);
    }
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    const all = await app.inject({ method: 'GET', url: `${base}?after=0`, headers: auth(c.channelToken) });
    const batches = all.json() as Array<{ seq: number; env: unknown }>;
    expect(batches.map((b) => b.seq)).toEqual(seqs);
    expect(batches[0]!.env).toEqual(envelope('b0'));

    const tail = await app.inject({ method: 'GET', url: `${base}?after=${seqs[1]}`, headers: auth(c.channelToken) });
    expect((tail.json() as Array<{ seq: number }>).map((b) => b.seq)).toEqual([seqs[2]]);

    const ack = await app.inject({ method: 'DELETE', url: `${base}?through=${seqs[1]}`, headers: auth(c.channelToken) });
    expect(ack.statusCode).toBe(204);
    const rest = await app.inject({ method: 'GET', url: `${base}?after=0`, headers: auth(c.channelToken) });
    expect((rest.json() as Array<{ seq: number }>).map((b) => b.seq)).toEqual([seqs[2]]);
  });

  it('Idempotency-Key: resending the same batch returns the original seq, no duplicate', async () => {
    const c = await provision();
    const base = `/v1/channels/${c.channelId}/outbox`;
    const headers = { ...auth(c.channelToken), 'idempotency-key': 'batch-uuid-1' };

    const first = await app.inject({ method: 'POST', url: base, headers, payload: envelope() });
    const second = await app.inject({ method: 'POST', url: base, headers, payload: envelope() });
    expect(first.json()).toEqual(second.json());

    const all = await app.inject({ method: 'GET', url: `${base}?after=0`, headers: auth(c.channelToken) });
    expect(all.json()).toHaveLength(1);
  });

  it('channels are isolated: outbox batches never leak across channels', async () => {
    const a = await provision();
    const b = await provision();
    await app.inject({
      method: 'POST',
      url: `/v1/channels/${a.channelId}/outbox`,
      headers: auth(a.channelToken),
      payload: envelope('a'),
    });
    const bList = await app.inject({
      method: 'GET',
      url: `/v1/channels/${b.channelId}/outbox?after=0`,
      headers: auth(b.channelToken),
    });
    expect(bList.json()).toEqual([]);
  });

  it('TTL sweep deletes unacked batches past the cutoff', async () => {
    const c = await provision();
    await app.inject({
      method: 'POST',
      url: `/v1/channels/${c.channelId}/outbox`,
      headers: auth(c.channelToken),
      payload: envelope(),
    });
    expect(storage.sweepOutboxOlderThan(clock.t - 100)).toBe(0); // not old yet
    expect(storage.sweepOutboxOlderThan(clock.t + 100)).toBe(1); // past TTL
  });
});

describe('rate limiting', () => {
  it('429 with Retry-After past the per-channel write budget; window resets', async () => {
    const c = await provision();
    const url = `/v1/channels/${c.channelId}/summary`;
    for (let i = 0; i < 5; i++) {
      expect(
        (await app.inject({ method: 'PUT', url, headers: auth(c.channelToken), payload: envelope() })).statusCode,
      ).toBe(204);
    }
    const limited = await app.inject({ method: 'PUT', url, headers: auth(c.channelToken), payload: envelope() });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

    // reads are not writes — GET still works while write-limited
    expect((await app.inject({ method: 'GET', url, headers: auth(c.channelToken) })).statusCode).toBe(200);

    clock.t += 61;
    expect(
      (await app.inject({ method: 'PUT', url, headers: auth(c.channelToken), payload: envelope() })).statusCode,
    ).toBe(204);
  });

  it('budget is per channel, not global', async () => {
    const a = await provision();
    const b = await provision();
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'PUT',
        url: `/v1/channels/${a.channelId}/summary`,
        headers: auth(a.channelToken),
        payload: envelope(),
      });
    }
    const other = await app.inject({
      method: 'PUT',
      url: `/v1/channels/${b.channelId}/summary`,
      headers: auth(b.channelToken),
      payload: envelope(),
    });
    expect(other.statusCode).toBe(204);
  });
});

describe('fuzz: malformed input → clean 4xx, never 5xx', () => {
  it('rejects garbage bodies, non-envelopes, and oversized payloads', async () => {
    const c = await provision();
    const url = `/v1/channels/${c.channelId}/summary`;

    const cases = [
      { payload: 'not json{{{', contentType: 'application/json' },
      { payload: JSON.stringify({ hello: 'world' }), contentType: 'application/json' },
      { payload: JSON.stringify({ v: 2, alg: 'x', nonce: 'y', ct: 'z' }), contentType: 'application/json' },
      { payload: JSON.stringify([1, 2, 3]), contentType: 'application/json' },
      { payload: 'null', contentType: 'application/json' },
      { payload: 'AAAA', contentType: 'application/octet-stream' },
    ];
    for (const { payload, contentType } of cases) {
      clock.t += 61;
      const res = await app.inject({
        method: 'PUT',
        url,
        headers: { ...auth(c.channelToken), 'content-type': contentType },
        payload,
      });
      expect(res.statusCode, `payload: ${payload.slice(0, 30)}`).toBeGreaterThanOrEqual(400);
      expect(res.statusCode, `payload: ${payload.slice(0, 30)}`).toBeLessThan(500);
    }

    const oversized = await app.inject({
      method: 'PUT',
      url,
      headers: { ...auth(c.channelToken), 'content-type': 'application/json' },
      payload: JSON.stringify({ v: 1, alg: 'x', nonce: 'y', ct: 'A'.repeat(300 * 1024) }),
    });
    expect(oversized.statusCode).toBe(413);

    const badQuery = await app.inject({
      method: 'GET',
      url: `/v1/channels/${c.channelId}/outbox?after=potato`,
      headers: auth(c.channelToken),
    });
    expect(badQuery.statusCode).toBe(400);

    const badAck = await app.inject({
      method: 'DELETE',
      url: `/v1/channels/${c.channelId}/outbox`,
      headers: auth(c.channelToken),
    });
    expect(badAck.statusCode).toBe(400);
  });
});

describe('log audit: the relay never logs secrets or blob contents', () => {
  it('no ct, nonce, or token material appears in any log line', async () => {
    const c = await provision();
    const env = envelope('secret');
    await app.inject({
      method: 'PUT',
      url: `/v1/channels/${c.channelId}/summary`,
      headers: auth(c.channelToken),
      payload: env,
    });
    await app.inject({
      method: 'POST',
      url: `/v1/channels/${c.channelId}/outbox`,
      headers: { ...auth(c.channelToken), 'idempotency-key': 'b-1' },
      payload: env,
    });
    await app.inject({ method: 'GET', url: `/v1/channels/${c.channelId}/summary`, headers: auth(c.channelToken) });
    // also a failing request — error paths must not echo bodies either
    await app.inject({
      method: 'PUT',
      url: `/v1/channels/${c.channelId}/summary`,
      headers: { ...auth(c.channelToken), 'content-type': 'application/json' },
      payload: 'not json' + env.ct,
    });

    expect(logs.length).toBeGreaterThan(0);
    const flat = JSON.stringify(logs);
    expect(flat).not.toContain(env.ct);
    expect(flat).not.toContain(env.nonce);
    expect(flat).not.toContain(c.channelToken);
    expect(flat).not.toContain('Bearer');
    expect(flat).toContain(c.channelId); // channelId IS allowed
  });
});

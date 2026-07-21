// Entrypoint: config via env, hourly TTL sweeper, graceful shutdown.
//   PORT            listen port (default 8080)
//   DB_PATH         SQLite file (default ./relay.db; /data/relay.db in Docker)
//   WRITES_PER_MIN  per-channel write budget (default 60)
//   OUTBOX_TTL_DAYS hard TTL safety net for unacked outbox batches (default 30)

import { buildApp } from './app.js';
import { SqliteStorage } from './storage.js';

const port = Number(process.env.PORT ?? 8080);
const dbPath = process.env.DB_PATH ?? 'relay.db';
const writesPerMin = Number(process.env.WRITES_PER_MIN ?? 60);
const ttlDays = Number(process.env.OUTBOX_TTL_DAYS ?? 30);

const storage = new SqliteStorage(dbPath);
const app = buildApp({ storage, writesPerMin });

const sweeper = setInterval(
  () => {
    const cutoff = Math.floor(Date.now() / 1000) - ttlDays * 86_400;
    const swept = storage.sweepOutboxOlderThan(cutoff);
    if (swept > 0) console.log(JSON.stringify({ t: Math.floor(Date.now() / 1000), swept }));
  },
  60 * 60 * 1000,
);
sweeper.unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      storage.close();
      process.exit(0);
    });
  });
}

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  console.error(err instanceof Error ? err.message : 'listen failed');
  process.exit(1);
});

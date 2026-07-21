// Storage adapter for the relay (spec T3). One concrete impl: SQLite via
// better-sqlite3 — a single transactional file holds channels, the
// latest-only summary per channel, and the outbox queue. The interface exists
// so a Postgres/object-store impl can slot in without touching routes.
//
// The relay is content-blind: envelopes are stored as opaque JSON strings.
// Tokens are stored as SHA-256 hashes — the plaintext token exists only in
// the provisioning response and the client's secure storage.

import Database from 'better-sqlite3';

export interface RelayStorage {
  createChannel(id: string, tokenHash: Buffer, createdAt: number): void;
  getTokenHash(channelId: string): Buffer | null;
  /** Replaces the stored latest summary (retention: latest only). */
  putSummary(channelId: string, envelopeJson: string, etag: string, updatedAt: number): void;
  getSummary(channelId: string): { envelopeJson: string; etag: string } | null;
  /** Appends a batch; idemKey dedupes (same key → original seq, existing=true). */
  appendOutbox(
    channelId: string,
    idemKey: string | null,
    envelopeJson: string,
    createdAt: number,
  ): { seq: number; existing: boolean };
  listOutbox(channelId: string, afterSeq: number): Array<{ seq: number; envelopeJson: string }>;
  deleteOutboxThrough(channelId: string, throughSeq: number): number;
  /** 30-day safety-net TTL (spec §6 non-functional). Returns rows deleted. */
  sweepOutboxOlderThan(cutoff: number): number;
  countSummaries(): number;
  close(): void;
}

export class SqliteStorage implements RelayStorage {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        token_hash BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS summaries (
        channel_id TEXT PRIMARY KEY REFERENCES channels(id),
        envelope TEXT NOT NULL,
        etag TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL REFERENCES channels(id),
        idem_key TEXT,
        envelope TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS outbox_idem
        ON outbox(channel_id, idem_key) WHERE idem_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS outbox_channel_seq ON outbox(channel_id, seq);
    `);
  }

  createChannel(id: string, tokenHash: Buffer, createdAt: number): void {
    this.db
      .prepare('INSERT INTO channels (id, token_hash, created_at) VALUES (?, ?, ?)')
      .run(id, tokenHash, createdAt);
  }

  getTokenHash(channelId: string): Buffer | null {
    const row = this.db.prepare('SELECT token_hash FROM channels WHERE id = ?').get(channelId) as
      | { token_hash: Buffer }
      | undefined;
    return row?.token_hash ?? null;
  }

  putSummary(channelId: string, envelopeJson: string, etag: string, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO summaries (channel_id, envelope, etag, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET envelope = excluded.envelope,
           etag = excluded.etag, updated_at = excluded.updated_at`,
      )
      .run(channelId, envelopeJson, etag, updatedAt);
  }

  getSummary(channelId: string): { envelopeJson: string; etag: string } | null {
    const row = this.db.prepare('SELECT envelope, etag FROM summaries WHERE channel_id = ?').get(channelId) as
      | { envelope: string; etag: string }
      | undefined;
    return row ? { envelopeJson: row.envelope, etag: row.etag } : null;
  }

  appendOutbox(
    channelId: string,
    idemKey: string | null,
    envelopeJson: string,
    createdAt: number,
  ): { seq: number; existing: boolean } {
    try {
      const res = this.db
        .prepare('INSERT INTO outbox (channel_id, idem_key, envelope, created_at) VALUES (?, ?, ?, ?)')
        .run(channelId, idemKey, envelopeJson, createdAt);
      return { seq: Number(res.lastInsertRowid), existing: false };
    } catch (err) {
      if (idemKey !== null && err instanceof Error && 'code' in err && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
        const row = this.db
          .prepare('SELECT seq FROM outbox WHERE channel_id = ? AND idem_key = ?')
          .get(channelId, idemKey) as { seq: number } | undefined;
        if (row) return { seq: row.seq, existing: true };
      }
      throw err;
    }
  }

  listOutbox(channelId: string, afterSeq: number): Array<{ seq: number; envelopeJson: string }> {
    const rows = this.db
      .prepare('SELECT seq, envelope FROM outbox WHERE channel_id = ? AND seq > ? ORDER BY seq ASC')
      .all(channelId, afterSeq) as Array<{ seq: number; envelope: string }>;
    return rows.map((r) => ({ seq: r.seq, envelopeJson: r.envelope }));
  }

  deleteOutboxThrough(channelId: string, throughSeq: number): number {
    return this.db.prepare('DELETE FROM outbox WHERE channel_id = ? AND seq <= ?').run(channelId, throughSeq).changes;
  }

  sweepOutboxOlderThan(cutoff: number): number {
    return this.db.prepare('DELETE FROM outbox WHERE created_at < ?').run(cutoff).changes;
  }

  countSummaries(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM summaries').get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}

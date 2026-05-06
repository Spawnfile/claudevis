import type { Event } from '@claudevis/shared';

export interface EventStore {
  append(event: Event): void;
  all(): Event[];
  bySession(sessionId: string): Event[];
  close(): void;
}

export type EventStoreOptions = { kind: 'memory' } | { kind: 'sqlite'; path: string };

export function createEventStore(opts: EventStoreOptions): EventStore {
  if (opts.kind === 'memory') return memoryStore();
  return sqliteStore(opts.path);
}

function memoryStore(): EventStore {
  const events: Event[] = [];
  return {
    append: (e) => {
      events.push(e);
    },
    all: () => events.slice(),
    bySession: (sid) => events.filter((e) => e.sessionId === sid),
    close: () => {
      events.length = 0;
    },
  };
}

function sqliteStore(path: string): EventStore {
  // Bun ships its own SQLite. Imported lazily so memory-only tests don't
  // pull it in (and so this file remains importable in non-Bun tools like
  // tsc and vitest if we ever need them).
  // biome-ignore lint/suspicious/noExplicitAny: dynamic require boundary
  const { Database } = require('bun:sqlite') as { Database: any };
  const db = new Database(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_session_idx ON events(session_id, ts);
  `);
  const insert = db.prepare('INSERT INTO events (id, ts, session_id, payload) VALUES (?, ?, ?, ?)');
  const selectAll = db.prepare('SELECT payload FROM events ORDER BY ts, id');
  const selectBySession = db.prepare(
    'SELECT payload FROM events WHERE session_id = ? ORDER BY ts, id',
  );
  return {
    append: (e) => {
      insert.run(e.id, e.ts, e.sessionId, JSON.stringify(e));
    },
    all: () =>
      (selectAll.all() as { payload: string }[]).map((r) => JSON.parse(r.payload) as Event),
    bySession: (sid) =>
      (selectBySession.all(sid) as { payload: string }[]).map(
        (r) => JSON.parse(r.payload) as Event,
      ),
    close: () => db.close(),
  };
}

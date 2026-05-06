import { describe, expect, it } from 'bun:test';
import type { Event } from '@claudevis/shared';
import { createEventStore } from '../src/event-store.js';

const makeEvent = (id: string, ts: number, sessionId: string): Event => ({
  id,
  ts,
  sessionId,
  type: 'session.started',
  name: 'demo',
  cwd: '/tmp',
  model: 'sonnet',
});

describe('EventStore (in-memory)', () => {
  it('stores and replays events in insertion order', () => {
    const store = createEventStore({ kind: 'memory' });
    store.append(makeEvent('a', 1, 's1'));
    store.append(makeEvent('b', 2, 's1'));
    store.append(makeEvent('c', 3, 's2'));
    expect(store.all().map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters replay by sessionId', () => {
    const store = createEventStore({ kind: 'memory' });
    store.append(makeEvent('a', 1, 's1'));
    store.append(makeEvent('b', 2, 's2'));
    expect(store.bySession('s1').map((e) => e.id)).toEqual(['a']);
    expect(store.bySession('s2').map((e) => e.id)).toEqual(['b']);
  });
});

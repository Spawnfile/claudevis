import { describe, expect, it } from 'bun:test';
import type { Event } from '@claudevis/shared';
import { filterZombieSessions } from '../src/replay-filter.js';

const ev = (sid: string, type: Event['type'], extra: Partial<Event> = {}): Event => {
  const variants: Partial<Record<Event['type'], Record<string, unknown>>> = {
    'session.started': { name: 'x', cwd: '/x', model: 'sonnet' },
    'session.ended': { reason: 'complete' as const },
    'user.prompt': { content: 'hi' },
  };
  return {
    id: `ev-${sid}-${type}`,
    ts: 0,
    sessionId: sid,
    type,
    ...(variants[type] ?? {}),
    ...extra,
  } as Event;
};

describe('filterZombieSessions', () => {
  it('returns empty array for empty input', () => {
    expect(filterZombieSessions([])).toEqual([]);
  });

  it('preserves sessions with no session.ended', () => {
    const events = [ev('s1', 'session.started'), ev('s1', 'user.prompt')];
    expect(filterZombieSessions(events)).toEqual(events);
  });

  it('filters out sessions that have a session.ended event', () => {
    const events = [
      ev('s1', 'session.started'),
      ev('s1', 'user.prompt'),
      ev('s1', 'session.ended'),
    ];
    expect(filterZombieSessions(events)).toEqual([]);
  });

  it('keeps live sessions while filtering ended ones in mixed input', () => {
    const events = [
      ev('s1', 'session.started'),
      ev('s2', 'session.started'),
      ev('s1', 'session.ended'),
      ev('s2', 'user.prompt'),
    ];
    const out = filterZombieSessions(events);
    expect(out).toEqual([ev('s2', 'session.started'), ev('s2', 'user.prompt')]);
  });

  it('preserves insertion order within surviving sessions', () => {
    const events = [ev('s1', 'user.prompt'), ev('s2', 'user.prompt'), ev('s1', 'session.started')];
    expect(filterZombieSessions(events).map((e) => e.id)).toEqual([
      'ev-s1-user.prompt',
      'ev-s2-user.prompt',
      'ev-s1-session.started',
    ]);
  });
});

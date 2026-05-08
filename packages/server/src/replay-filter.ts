import type { Event } from '@claudevis/shared';

/**
 * Returns the input event list with all events from sessions that have
 * received a `session.ended` event filtered out. Insertion order preserved.
 *
 * Used by the WS server's `subscribe` handler when the client subscribes to
 * `sessionIds: '*'` (bulk replay) to suppress "shadow NPCs" from prior dev
 * runs. Sessions explicitly named in `sessionIds` bypass this filter — the
 * caller knows what it wants in that path.
 */
export function filterZombieSessions(events: Event[]): Event[] {
  const ended = new Set<string>();
  for (const e of events) {
    if (e.type === 'session.ended') ended.add(e.sessionId);
  }
  return events.filter((e) => !ended.has(e.sessionId));
}

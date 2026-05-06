import { describe, expect, it } from 'vitest';
import { CommandSchema, EventSchema } from '../src/schemas.js';

describe('EventSchema', () => {
  it('parses a session.started event', () => {
    const valid = {
      id: 'ev-1',
      ts: 1700000000000,
      sessionId: 'sess-a',
      type: 'session.started' as const,
      name: 'demo',
      cwd: '/tmp',
      model: 'sonnet',
    };
    expect(EventSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an event with unknown type', () => {
    const invalid = {
      id: 'ev-1',
      ts: 1,
      sessionId: 's',
      type: 'session.exploded',
    };
    expect(() => EventSchema.parse(invalid)).toThrow();
  });

  it('parses a tool.completed event with status enum', () => {
    expect(() =>
      EventSchema.parse({
        id: 'e',
        ts: 1,
        sessionId: 's',
        type: 'tool.completed',
        callId: 'c',
        output: {},
        status: 'ok',
        durationMs: 12,
      }),
    ).not.toThrow();
  });
});

describe('CommandSchema', () => {
  it('parses a session.create command', () => {
    expect(() =>
      CommandSchema.parse({ type: 'session.create', cwd: '/tmp', name: 'a' }),
    ).not.toThrow();
  });

  it('rejects a session.send without sessionId', () => {
    expect(() => CommandSchema.parse({ type: 'session.send', content: 'hi' })).toThrow();
  });
});

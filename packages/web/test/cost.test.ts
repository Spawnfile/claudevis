import type { Event } from '@claudevis/shared';
import { describe, expect, it } from 'vitest';
import { aggregateCost } from '../src/cost.js';

const tok = (over: Partial<Extract<Event, { type: 'tokens.updated' }>>): Event =>
  ({
    id: 't',
    ts: 0,
    sessionId: 's1',
    type: 'tokens.updated',
    input: 0,
    output: 0,
    cached: 0,
    costUsd: 0,
    model: 'fake',
    ...over,
  }) as Event;

describe('aggregateCost', () => {
  it('returns zero summary for empty events', () => {
    expect(aggregateCost([], 's1')).toEqual({
      inputTotal: 0,
      outputTotal: 0,
      cachedTotal: 0,
      costUsdTotal: 0,
      lastInput: 0,
      lastOutput: 0,
      lastCached: 0,
      lastCostUsd: 0,
    });
  });

  it('sums per-event tokens for the matching sessionId', () => {
    const evs = [
      tok({ id: 'a', input: 100, output: 50, cached: 10, costUsd: 0.001 }),
      tok({ id: 'b', input: 200, output: 80, cached: 20, costUsd: 0.002 }),
    ];
    const out = aggregateCost(evs, 's1');
    expect(out.inputTotal).toBe(300);
    expect(out.outputTotal).toBe(130);
    expect(out.cachedTotal).toBe(30);
    expect(out.costUsdTotal).toBeCloseTo(0.003, 6);
    expect(out.lastInput).toBe(200);
    expect(out.lastCostUsd).toBeCloseTo(0.002, 6);
  });

  it('ignores events from other sessions', () => {
    const evs = [
      tok({ id: 'a', sessionId: 's1', costUsd: 0.001 }),
      tok({ id: 'b', sessionId: 's2', costUsd: 99 }),
    ];
    expect(aggregateCost(evs, 's1').costUsdTotal).toBeCloseTo(0.001, 6);
  });

  it('ignores non-tokens.updated events', () => {
    const evs: Event[] = [
      { id: 'a', ts: 0, sessionId: 's1', type: 'user.prompt', content: 'hi' } as Event,
      tok({ id: 'b', costUsd: 0.5 }),
    ];
    expect(aggregateCost(evs, 's1').costUsdTotal).toBeCloseTo(0.5, 6);
  });
});

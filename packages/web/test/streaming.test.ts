import type { Event } from '@claudevis/shared';
import { describe, expect, it } from 'vitest';
import { collapseStreamingMessages } from '../src/streaming.js';

const agentMsg = (
  over: Partial<Extract<Event, { type: 'agent.message' }>> = {},
): Extract<Event, { type: 'agent.message' }> => ({
  id: 'e1',
  ts: 0,
  sessionId: 's1',
  type: 'agent.message',
  content: '',
  streaming: false,
  ...over,
});

const agentThink = (
  over: Partial<Extract<Event, { type: 'agent.thinking' }>> = {},
): Extract<Event, { type: 'agent.thinking' }> => ({
  id: 'e1',
  ts: 0,
  sessionId: 's1',
  type: 'agent.thinking',
  content: '',
  streaming: false,
  ...over,
});

const userPrompt = (
  over: Partial<Extract<Event, { type: 'user.prompt' }>> = {},
): Extract<Event, { type: 'user.prompt' }> => ({
  id: 'e1',
  ts: 0,
  sessionId: 's1',
  type: 'user.prompt',
  content: '',
  ...over,
});

const toolStarted = (
  over: Partial<Extract<Event, { type: 'tool.started' }>> = {},
): Extract<Event, { type: 'tool.started' }> => ({
  id: 'e1',
  ts: 0,
  sessionId: 's1',
  type: 'tool.started',
  callId: 'c',
  name: 'Read',
  input: null,
  ...over,
});

describe('collapseStreamingMessages', () => {
  it('returns empty array for empty input', () => {
    expect(collapseStreamingMessages([])).toEqual([]);
  });

  it('passes through non-streaming events unchanged', () => {
    const evs: Event[] = [
      userPrompt({ id: 'a', content: 'hi' }),
      agentMsg({ id: 'b', content: 'done', streaming: false }),
    ];
    expect(collapseStreamingMessages(evs)).toEqual(evs);
  });

  it('collapses three streaming chunks + final non-streaming into one event with canonical content', () => {
    const evs: Event[] = [
      agentMsg({ id: 'a', content: 'hel', streaming: true }),
      agentMsg({ id: 'b', content: 'lo ', streaming: true }),
      agentMsg({ id: 'c', content: 'wor', streaming: true }),
      agentMsg({ id: 'd', content: 'hello world', streaming: false }),
    ];
    const out = collapseStreamingMessages(evs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'd', content: 'hello world', streaming: false });
  });

  it('with no terminating non-streaming event, exposes accumulated chunks under head id', () => {
    const evs: Event[] = [
      agentMsg({ id: 'a', content: 'foo', streaming: true }),
      agentMsg({ id: 'b', content: 'bar', streaming: true }),
    ];
    const out = collapseStreamingMessages(evs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', content: 'foobar', streaming: true });
  });

  it('keeps independent runs across sessions', () => {
    const evs: Event[] = [
      agentMsg({ id: 'a', sessionId: 's1', content: 'A', streaming: true }),
      agentMsg({ id: 'b', sessionId: 's2', content: 'X', streaming: true }),
      agentMsg({ id: 'c', sessionId: 's1', content: 'B', streaming: true }),
      agentMsg({ id: 'd', sessionId: 's1', content: 'AB', streaming: false }),
      agentMsg({ id: 'e', sessionId: 's2', content: 'X', streaming: false }),
    ];
    const out = collapseStreamingMessages(evs);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'd', sessionId: 's1', content: 'AB' });
    expect(out[1]).toMatchObject({ id: 'e', sessionId: 's2', content: 'X' });
  });

  it('keeps agent.thinking and agent.message on same session in independent runs', () => {
    const evs: Event[] = [
      agentThink({ id: 'a', content: 'th', streaming: true }),
      agentMsg({ id: 'b', content: 'ms', streaming: true }),
      agentThink({ id: 'c', content: 'th-final', streaming: false }),
      agentMsg({ id: 'd', content: 'ms-final', streaming: false }),
    ];
    const out = collapseStreamingMessages(evs);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'c', type: 'agent.thinking', content: 'th-final' });
    expect(out[1]).toMatchObject({ id: 'd', type: 'agent.message', content: 'ms-final' });
  });

  it('does not terminate a run when an unrelated event appears mid-stream', () => {
    const evs: Event[] = [
      agentMsg({ id: 'a', content: 'X', streaming: true }),
      toolStarted({ id: 'b', sessionId: 's1', callId: 'c', name: 'Read', input: null }),
      agentMsg({ id: 'c', content: 'Y', streaming: true }),
      agentMsg({ id: 'd', content: 'XY', streaming: false }),
    ];
    const out = collapseStreamingMessages(evs);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'b', type: 'tool.started' });
    expect(out[1]).toMatchObject({ id: 'd', content: 'XY' });
  });

  it('passes through a solo streaming:false event when no prior run exists for its key', () => {
    const evs: Event[] = [agentMsg({ id: 'a', content: 'one-shot', streaming: false })];
    const out = collapseStreamingMessages(evs);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', content: 'one-shot', streaming: false });
  });
});

import type { Event } from '@claudevis/shared';
// packages/web/test/scene/event-mapper.test.ts
import { describe, expect, it } from 'vitest';
import { eventToMutations } from '../../src/scene/event-mapper';

const baseEvent = {
  id: 'ev-1',
  ts: 1700000000000,
  sessionId: 'session-1',
};

describe('event-mapper.eventToMutations (M3c.1)', () => {
  it('session.started → spawnNpc mutation', () => {
    const e: Event = {
      ...baseEvent,
      type: 'session.started',
      name: 'test-session',
      cwd: '/tmp/example',
      model: 'sonnet',
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'spawnNpc', sessionId: 'session-1', model: 'sonnet', name: 'test-session' },
    ]);
  });

  it('session.ended → removeNpc mutation', () => {
    const e: Event = {
      ...baseEvent,
      type: 'session.ended',
      reason: 'user',
    };
    expect(eventToMutations(e)).toEqual([{ kind: 'removeNpc', sessionId: 'session-1' }]);
  });

  it('tokens.updated → updateStamina mutation', () => {
    const e: Event = {
      ...baseEvent,
      type: 'tokens.updated',
      input: 1234,
      output: 567,
      cached: 0,
      costUsd: 0.234,
      model: 'sonnet',
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'updateStamina', sessionId: 'session-1', costUsd: 0.234, model: 'sonnet' },
    ]);
  });

  it('error → errorFlash mutation', () => {
    const e: Event = {
      ...baseEvent,
      type: 'error',
      message: 'something went wrong',
      recoverable: false,
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'errorFlash', message: 'something went wrong', sessionId: 'session-1' },
    ]);
  });

  it('user.prompt → empty array (M3c.2a fills this)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'user.prompt',
      content: 'hello',
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('agent.thinking → empty array (M3c.2a fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'agent.thinking',
      content: 'thinking...',
      streaming: false,
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('agent.message → empty array (M3c.2a fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'agent.message',
      content: 'hi',
      streaming: false,
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('tool.started → empty array (M3c.2a fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'tool.started',
      callId: 'call-1',
      name: 'Bash',
      input: {},
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('tool.completed → empty array (M3c.2a fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'tool.completed',
      callId: 'call-1',
      output: 'ok',
      status: 'ok',
      durationMs: 100,
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('subagent.dispatched → empty array (M3c.2b fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'subagent.dispatched',
      parentCallId: 'call-1',
      agentType: 'planner',
      prompt: 'plan stuff',
      childSessionId: 'child-1',
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('subagent.completed → empty array (M3c.2b fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'subagent.completed',
      parentCallId: 'call-1',
      childSessionId: 'child-1',
      result: 'ok',
      status: 'ok',
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('file.changed → empty array (M3c.2b fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'file.changed',
      path: '/tmp/x.txt',
      plus: 0,
      minus: 0,
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('permission.requested → empty array (M3c.2b fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'permission.requested',
      requestId: 'req-1',
      toolName: 'Bash',
      toolInput: {},
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('permission.resolved → empty array (M3c.2b fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'permission.resolved',
      requestId: 'req-1',
      decision: 'allow',
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('skill.invoked → empty array (M3c.2b fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'skill.invoked',
      skillName: 'foo',
    };
    expect(eventToMutations(e)).toEqual([]);
  });

  it('interrupt.signaled → empty array (M3c.3 fills)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'interrupt.signaled',
    };
    expect(eventToMutations(e)).toEqual([]);
  });
});

import type { Event } from '@claudevis/shared';
// packages/web/test/scene/event-mapper.test.ts
import { describe, expect, it } from 'vitest';
import { eventToMutations } from '../../src/scene/event-mapper';

const baseEvent = {
  id: 'ev-1',
  ts: 1700000000000,
  sessionId: 'session-1',
};

describe('event-mapper.eventToMutations (M3c.1 + M3c.2a + M3c.2b)', () => {
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
    const e: Event = { ...baseEvent, type: 'session.ended', reason: 'user' };
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

  it('user.prompt → glyph parchment mutation (2s) with content', () => {
    const e: Event = { ...baseEvent, type: 'user.prompt', content: 'hello' };
    expect(eventToMutations(e)).toEqual([
      {
        kind: 'glyph',
        sessionId: 'session-1',
        sprite: 'glyphParchment',
        durationMs: 2000,
        content: 'hello',
      },
    ]);
  });

  it('agent.thinking → thoughtCloud mutation with content', () => {
    const e: Event = {
      ...baseEvent,
      type: 'agent.thinking',
      content: 'thinking...',
      streaming: false,
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'thoughtCloud', sessionId: 'session-1', content: 'thinking...' },
    ]);
  });

  it('agent.message → speechBubble mutation with content truncated to 40 chars', () => {
    const longText = 'a'.repeat(100);
    const e: Event = {
      ...baseEvent,
      type: 'agent.message',
      content: longText,
      streaming: false,
    };
    expect(eventToMutations(e)).toEqual([
      {
        kind: 'speechBubble',
        sessionId: 'session-1',
        content: 'a'.repeat(40),
        durationMs: 3000,
      },
    ]);
  });

  it('agent.message → speechBubble mutation passes short content unchanged', () => {
    const e: Event = {
      ...baseEvent,
      type: 'agent.message',
      content: 'hi',
      streaming: false,
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'speechBubble', sessionId: 'session-1', content: 'hi', durationMs: 3000 },
    ]);
  });

  it('tool.started → attachTool mutation', () => {
    const e: Event = {
      ...baseEvent,
      type: 'tool.started',
      callId: 'call-1',
      name: 'Bash',
      input: {},
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'attachTool', sessionId: 'session-1', callId: 'call-1', name: 'Bash' },
    ]);
  });

  it('tool.completed → retractTool mutation with ok status', () => {
    const e: Event = {
      ...baseEvent,
      type: 'tool.completed',
      callId: 'call-1',
      output: 'ok',
      status: 'ok',
      durationMs: 100,
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'retractTool', sessionId: 'session-1', callId: 'call-1', status: 'ok' },
    ]);
  });

  it('tool.completed → retractTool mutation with error status', () => {
    const e: Event = {
      ...baseEvent,
      type: 'tool.completed',
      callId: 'call-2',
      output: 'boom',
      status: 'error',
      durationMs: 100,
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'retractTool', sessionId: 'session-1', callId: 'call-2', status: 'error' },
    ]);
  });

  // M3c.2b: 6 new active cases.

  it('subagent.dispatched → TWO mutations (summonRing + spawnSubagentNpc)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'subagent.dispatched',
      parentCallId: 'call-1',
      agentType: 'planner',
      prompt: 'plan stuff',
      childSessionId: 'child-1',
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'summonRing', parentSessionId: 'session-1', parentCallId: 'call-1' },
      {
        kind: 'spawnSubagentNpc',
        childSessionId: 'child-1',
        parentSessionId: 'session-1',
        agentType: 'planner',
      },
    ]);
  });

  it('subagent.completed → removeSubagentNpc mutation (with parentCallId for ring cleanup)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'subagent.completed',
      parentCallId: 'call-1',
      childSessionId: 'child-1',
      result: 'ok',
      status: 'ok',
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'removeSubagentNpc', childSessionId: 'child-1', parentCallId: 'call-1' },
    ]);
  });

  it('file.changed → fileFly mutation with path', () => {
    const e: Event = {
      ...baseEvent,
      type: 'file.changed',
      path: '/tmp/x.txt',
      plus: 0,
      minus: 0,
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'fileFly', sessionId: 'session-1', path: '/tmp/x.txt' },
    ]);
  });

  it('permission.requested → permissionSigil mutation (interactive — req-fake- prefix)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'permission.requested',
      requestId: 'req-fake-1',
      toolName: 'Bash',
      toolInput: {},
    };
    expect(eventToMutations(e)).toEqual([
      {
        kind: 'permissionSigil',
        sessionId: 'session-1',
        requestId: 'req-fake-1',
        autoDeny: false,
        toolName: 'Bash',
      },
    ]);
  });

  it('permission.requested → permissionSigil mutation (auto-deny — auto-deny- prefix)', () => {
    const e: Event = {
      ...baseEvent,
      type: 'permission.requested',
      requestId: 'auto-deny-7',
      toolName: 'Bash',
      toolInput: {},
    };
    expect(eventToMutations(e)).toEqual([
      {
        kind: 'permissionSigil',
        sessionId: 'session-1',
        requestId: 'auto-deny-7',
        autoDeny: true,
        toolName: 'Bash',
      },
    ]);
  });

  it('permission.resolved → dismissSigil mutation', () => {
    const e: Event = {
      ...baseEvent,
      type: 'permission.resolved',
      requestId: 'req-fake-1',
      decision: 'allow',
    };
    expect(eventToMutations(e)).toEqual([
      { kind: 'dismissSigil', requestId: 'req-fake-1', decision: 'allow' },
    ]);
  });

  it('skill.invoked → skillParchment mutation with skillName', () => {
    const e: Event = { ...baseEvent, type: 'skill.invoked', skillName: 'foo' };
    expect(eventToMutations(e)).toEqual([
      { kind: 'skillParchment', sessionId: 'session-1', skillName: 'foo' },
    ]);
  });

  // Remaining M3c.3 deferral.
  it('interrupt.signaled → empty array (M3c.3 fills)', () => {
    const e: Event = { ...baseEvent, type: 'interrupt.signaled' };
    expect(eventToMutations(e)).toEqual([]);
  });
});

import { describe, expect, it } from 'bun:test';
import { type ParserContext, createRealCliParser } from '../src/real-claude-parser.js';

function freshCtx(): ParserContext {
  let n = 0;
  return {
    sessionId: 'sess-test',
    name: 'test',
    cwd: '/tmp/test',
    model: 'sonnet',
    repo: undefined,
    branch: undefined,
    newEventId: () => `ev-${++n}`,
    now: () => 1_700_000_000_000,
  };
}

const ctx = freshCtx();

describe('createRealCliParser', () => {
  it('returns [] for non-object input', () => {
    const p = createRealCliParser(ctx);
    expect(p('garbage')).toEqual([]);
    expect(p(null)).toEqual([]);
    expect(p(123)).toEqual([]);
  });

  it('returns [] for objects with no string `type` field', () => {
    const p = createRealCliParser(ctx);
    expect(p({})).toEqual([]);
    expect(p({ type: 42 })).toEqual([]);
  });

  it('returns [] for unknown line types', () => {
    const p = createRealCliParser(ctx);
    expect(p({ type: 'some_future_event', foo: 'bar' })).toEqual([]);
  });
});

describe('createRealCliParser — system events', () => {
  const p = createRealCliParser(ctx);
  it('drops hook_started lines', () => {
    expect(p({ type: 'system', subtype: 'hook_started', hook_id: 'h1' })).toEqual([]);
  });
  it('drops hook_response lines', () => {
    expect(p({ type: 'system', subtype: 'hook_response', hook_id: 'h1', exit_code: 0 })).toEqual(
      [],
    );
  });
  it('drops unknown system subtypes', () => {
    expect(p({ type: 'system', subtype: 'something_new' })).toEqual([]);
  });
});

describe('createRealCliParser — session.started', () => {
  it('maps system/init to session.started using context fields', () => {
    const p = createRealCliParser(ctx);
    const out = p({
      type: 'system',
      subtype: 'init',
      session_id: 'cli-internal-id',
      cwd: '/tmp/whatever',
      model: 'claude-sonnet-from-cli',
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'session.started',
      sessionId: 'sess-test',
      name: 'test',
      cwd: '/tmp/test',
      model: 'sonnet',
    });
  });

  it('emits session.started only on the first init', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({ type: 'system', subtype: 'init' });
    expect(out).toEqual([]);
  });
});

describe('createRealCliParser — agent.message', () => {
  it('maps assistant text content blocks to agent.message', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' }); // emit session.started first
    const out = p({
      type: 'assistant',
      message: {
        id: 'msg_1',
        role: 'assistant',
        content: [{ type: 'text', text: 'hello' }],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'agent.message',
      content: 'hello',
      streaming: false,
      sessionId: 'sess-test',
    });
  });

  it('emits one agent.message per text block', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'part one' },
          { type: 'text', text: 'part two' },
        ],
      },
    });
    expect(out.map((e) => (e as { type: string; content?: string }).content)).toEqual([
      'part one',
      'part two',
    ]);
  });

  it('returns [] when assistant message has no text blocks', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({ type: 'assistant', message: { content: [] } });
    expect(out).toEqual([]);
  });
});

describe('createRealCliParser — agent.thinking', () => {
  it('maps thinking content blocks to agent.thinking', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'I should read the file first.' },
          { type: 'text', text: 'Reading.' },
        ],
      },
    });
    const types = out.map((e) => e.type);
    expect(types).toEqual(['agent.thinking', 'agent.message']);
    expect((out[0] as { content: string }).content).toBe('I should read the file first.');
  });
});

describe('createRealCliParser — tool.started', () => {
  it('maps tool_use content blocks to tool.started', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_abc', name: 'Read', input: { file_path: '/tmp/x' } },
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'tool.started',
      callId: 'toolu_abc',
      name: 'Read',
      input: { file_path: '/tmp/x' },
    });
  });
});

describe('createRealCliParser — tool.completed', () => {
  it('maps tool_result blocks in user-role lines to tool.completed', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    p({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }] },
    });
    const out = p({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'file contents',
            is_error: false,
          },
        ],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'tool.completed',
      callId: 'toolu_1',
      status: 'ok',
      output: 'file contents',
    });
  });

  it('marks tool_result as error when is_error is true', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    p({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} }] },
    });
    const out = p({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_2',
            content: 'permission denied',
            is_error: true,
          },
        ],
      },
    });
    expect((out[0] as { status: string }).status).toBe('error');
  });
});

describe('createRealCliParser — user echo dedup', () => {
  it('drops user-role lines that only contain text blocks (echoes)', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    });
    expect(out).toEqual([]);
  });
});

describe('createRealCliParser — result/tokens', () => {
  it('maps result success to tokens.updated', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.0123,
      usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 50 },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'tokens.updated',
      input: 100,
      output: 200,
      cached: 50,
      costUsd: 0.0123,
      model: 'sonnet',
    });
  });

  it('maps result with missing usage fields to zeros', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({ type: 'result', subtype: 'success' });
    expect(out[0]).toMatchObject({
      type: 'tokens.updated',
      input: 0,
      output: 0,
      cached: 0,
      costUsd: 0,
    });
  });
});

describe('createRealCliParser — error', () => {
  it('maps result with non-success subtype to error event', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({ type: 'result', subtype: 'error_max_turns', error: 'turn limit reached' });
    expect(out.find((e) => e.type === 'error')).toMatchObject({
      type: 'error',
      message: expect.stringContaining('error_max_turns'),
      recoverable: true,
    });
  });

  it('maps top-level error type to error event', () => {
    const p = createRealCliParser(ctx);
    p({ type: 'system', subtype: 'init' });
    const out = p({ type: 'error', message: 'something broke' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'error',
      message: 'something broke',
      recoverable: true,
    });
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('createRealCliParser — fixture replay', () => {
  const dir = join(import.meta.dir, 'fixtures', 'real-claude-captures');

  const cases: Array<{ file: string; expectTypes: string[] }> = [
    {
      file: 'greeting.ndjson',
      expectTypes: ['session.started', 'agent.message', 'tokens.updated'],
    },
    {
      file: 'tool-read.ndjson',
      expectTypes: [
        'session.started',
        'tool.started',
        'tool.completed',
        'agent.message',
        'tokens.updated',
      ],
    },
  ];

  for (const c of cases) {
    const fullPath = join(dir, c.file);
    const condition = !existsSync(fullPath);
    it.skipIf(condition)(`replays ${c.file} into the expected event sequence`, () => {
      const raw = readFileSync(fullPath, 'utf8').trim().split('\n');
      const lines = raw.map((l) => JSON.parse(l));
      const p = createRealCliParser(freshCtx());
      const events = lines.flatMap((l) => p(l));
      const types = events.map((e) => e.type);

      for (const t of c.expectTypes) {
        expect(types).toContain(t as (typeof types)[number]);
      }
      const indices = c.expectTypes.map((t) => types.indexOf(t as (typeof types)[number]));
      const sorted = [...indices].sort((a, b) => a - b);
      expect(indices).toEqual(sorted);
    });
  }
});

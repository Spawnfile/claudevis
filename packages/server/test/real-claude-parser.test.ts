import { describe, expect, it } from 'bun:test';
import {
  type ParserContext,
  type RealCliLineParser,
  createRealCliParser,
} from '../src/real-claude-parser.js';

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

describe('createRealCliParser — file.changed synthesis', () => {
  function emitWriteCall(p: RealCliLineParser, callId: string, filePath: string) {
    return p({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: callId,
            name: 'Write',
            input: { file_path: filePath, content: 'body' },
          },
        ],
      },
    });
  }

  function emitToolResult(p: RealCliLineParser, callId: string, content: unknown, isError = false) {
    return p({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: callId, content, is_error: isError }],
      },
    });
  }

  it('emits tool.started AND tool.completed AND file.changed for a Write call', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });

    const startEvents = emitWriteCall(p, 'toolu_w1', '/tmp/x.txt');
    expect(startEvents.map((e) => e.type)).toEqual(['tool.started']);

    const finishEvents = emitToolResult(p, 'toolu_w1', 'wrote 1 file');
    expect(finishEvents.map((e) => e.type)).toEqual(['tool.completed', 'file.changed']);

    const changed = finishEvents.find((e) => e.type === 'file.changed');
    expect(changed).toMatchObject({
      type: 'file.changed',
      path: '/tmp/x.txt',
      plus: 0,
      minus: 0,
      preview: 'wrote 1 file',
    });
  });

  it('emits file.changed for Edit calls using file_path', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    p({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_e1',
            name: 'Edit',
            input: { file_path: '/tmp/y.txt', old_string: 'a', new_string: 'b' },
          },
        ],
      },
    });
    const out = emitToolResult(p, 'toolu_e1', 'edited');
    expect(out.find((e) => e.type === 'file.changed')).toMatchObject({
      type: 'file.changed',
      path: '/tmp/y.txt',
    });
  });

  it('emits file.changed for MultiEdit calls', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    p({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_m1',
            name: 'MultiEdit',
            input: { file_path: '/tmp/z.txt', edits: [] },
          },
        ],
      },
    });
    const out = emitToolResult(p, 'toolu_m1', 'edited');
    expect(out.find((e) => e.type === 'file.changed')).toMatchObject({ path: '/tmp/z.txt' });
  });

  it('emits file.changed for NotebookEdit using notebook_path', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    p({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_n1',
            name: 'NotebookEdit',
            input: { notebook_path: '/tmp/n.ipynb', cell_id: 'c1', new_source: '' },
          },
        ],
      },
    });
    const out = emitToolResult(p, 'toolu_n1', 'notebook edited');
    expect(out.find((e) => e.type === 'file.changed')).toMatchObject({ path: '/tmp/n.ipynb' });
  });

  it('does NOT emit file.changed when tool_result is_error is true', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    emitWriteCall(p, 'toolu_err', '/tmp/x.txt');
    const out = emitToolResult(p, 'toolu_err', 'permission denied', true);
    expect(out.map((e) => e.type)).toEqual(['tool.completed']);
    expect(out.find((e) => e.type === 'file.changed')).toBeUndefined();
  });

  it('does NOT emit file.changed when input has no file_path or notebook_path', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    p({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_bad', name: 'Write', input: { content: 'no path' } },
        ],
      },
    });
    const out = emitToolResult(p, 'toolu_bad', 'ok');
    expect(out.map((e) => e.type)).toEqual(['tool.completed']);
  });

  it('does NOT emit file.changed for non-mutating tools (Read)', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    p({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_r1',
            name: 'Read',
            input: { file_path: '/tmp/r.txt' },
          },
        ],
      },
    });
    const out = emitToolResult(p, 'toolu_r1', 'file body');
    expect(out.map((e) => e.type)).toEqual(['tool.completed']);
  });

  it('truncates preview to first 200 characters', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    emitWriteCall(p, 'toolu_long', '/tmp/long.txt');
    const huge = 'x'.repeat(500);
    const out = emitToolResult(p, 'toolu_long', huge);
    const changed = out.find((e) => e.type === 'file.changed') as { preview?: string } | undefined;
    expect(changed?.preview?.length).toBe(200);
  });

  it('coerces non-string tool_result content to JSON for preview', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    emitWriteCall(p, 'toolu_obj', '/tmp/obj.txt');
    const out = emitToolResult(p, 'toolu_obj', [{ type: 'text', text: 'wrote' }]);
    const changed = out.find((e) => e.type === 'file.changed') as { preview?: string } | undefined;
    expect(typeof changed?.preview).toBe('string');
    expect(changed?.preview).toContain('wrote');
  });
});

describe('createRealCliParser — subagent.* synthesis (REPLACE policy)', () => {
  function emitTaskCall(
    p: RealCliLineParser,
    callId: string,
    subagentType: string,
    prompt: string,
  ) {
    return p({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: callId,
            name: 'Agent',
            input: { subagent_type: subagentType, prompt, description: 'task description' },
          },
        ],
      },
    });
  }

  function emitTaskResult(p: RealCliLineParser, callId: string, content: unknown, isError = false) {
    return p({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: callId, content, is_error: isError }],
      },
    });
  }

  it('emits subagent.dispatched (NOT tool.started) for an Agent tool_use', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    const out = emitTaskCall(p, 'toolu_t1', 'planner', 'plan it');
    expect(out.map((e) => e.type)).toEqual(['subagent.dispatched']);
    expect(out[0]).toMatchObject({
      type: 'subagent.dispatched',
      parentCallId: 'toolu_t1',
      agentType: 'planner',
      prompt: 'plan it',
      childSessionId: 'toolu_t1',
    });
  });

  it('emits subagent.completed (NOT tool.completed) for the matching tool_result', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    emitTaskCall(p, 'toolu_t2', 'researcher', 'research it');
    const out = emitTaskResult(p, 'toolu_t2', 'final result string');
    expect(out.map((e) => e.type)).toEqual(['subagent.completed']);
    expect(out[0]).toMatchObject({
      type: 'subagent.completed',
      parentCallId: 'toolu_t2',
      childSessionId: 'toolu_t2',
      result: 'final result string',
      status: 'ok',
    });
  });

  it('marks subagent.completed as error when is_error is true', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    emitTaskCall(p, 'toolu_t3', 'planner', 'plan it');
    const out = emitTaskResult(p, 'toolu_t3', 'failed', true);
    expect(out[0]).toMatchObject({ type: 'subagent.completed', status: 'error' });
  });

  it('extracts the first text block when result content is a structured array', () => {
    // The real CLI's Agent tool_result wraps content in an array of two
    // text blocks: [0] is the subagent's text output, [1] is agent
    // metadata (agentId, usage). The parser should surface item 0.
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    emitTaskCall(p, 'toolu_t4', 'planner', 'plan it');
    const out = emitTaskResult(p, 'toolu_t4', [
      { type: 'text', text: 'subagent answer' },
      { type: 'text', text: 'agentId: ax (use SendMessage...)' },
    ]);
    expect(out[0]).toMatchObject({
      type: 'subagent.completed',
      result: 'subagent answer',
      status: 'ok',
    });
  });

  it('falls back to "unknown" agentType when subagent_type is missing', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    const out = p({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_no_type', name: 'Agent', input: { prompt: 'hi' } },
        ],
      },
    });
    expect((out[0] as { agentType: string }).agentType).toBe('unknown');
  });

  it('falls back to empty string when prompt is missing', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });
    const out = p({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_no_prompt',
            name: 'Agent',
            input: { subagent_type: 'researcher' },
          },
        ],
      },
    });
    expect((out[0] as { prompt: string }).prompt).toBe('');
  });

  it('keeps Agent and Edit calls independent (parallel mix)', () => {
    const p = createRealCliParser(freshCtx());
    p({ type: 'system', subtype: 'init' });

    // Both calls launched in the same assistant message.
    const startBoth = p({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_task',
            name: 'Agent',
            input: { subagent_type: 'planner', prompt: 'p' },
          },
          {
            type: 'tool_use',
            id: 'toolu_write',
            name: 'Write',
            input: { file_path: '/tmp/p.txt', content: 'hi' },
          },
        ],
      },
    });
    expect(startBoth.map((e) => e.type)).toEqual(['subagent.dispatched', 'tool.started']);

    // Agent result first.
    const taskOut = p({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'done' }],
      },
    });
    expect(taskOut.map((e) => e.type)).toEqual(['subagent.completed']);

    // Write result second.
    const writeOut = p({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_write', content: 'wrote' }],
      },
    });
    expect(writeOut.map((e) => e.type)).toEqual(['tool.completed', 'file.changed']);
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
    {
      file: 'edit-file.ndjson',
      expectTypes: [
        'session.started',
        'tool.started',
        'tool.completed',
        'file.changed',
        'tokens.updated',
      ],
    },
    {
      file: 'subagent-task.ndjson',
      expectTypes: [
        'session.started',
        'subagent.dispatched',
        'subagent.completed',
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

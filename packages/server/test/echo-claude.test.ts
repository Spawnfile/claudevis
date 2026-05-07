import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import path from 'node:path';

const fixturePath = path.resolve(__dirname, 'fixtures/echo-claude.ts');

interface FixtureOptions {
  prompt?: string;
  responses?: Array<{ type: string; request_id?: string; decision?: string }>;
  responseDelayMs?: number;
  timeoutMs?: number;
}

async function runFixture(opts: FixtureOptions): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [fixturePath]);
    const lines: string[] = [];
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        lines.push(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', reject);

    setTimeout(() => {
      child.kill('SIGTERM');
      try {
        resolve(lines.map((l) => JSON.parse(l)));
      } catch (err) {
        reject(err);
      }
    }, opts.timeoutMs ?? 1500);

    if (opts.prompt) {
      child.stdin.write(`${JSON.stringify({ type: 'user.prompt', content: opts.prompt })}\n`);
    }

    if (opts.responses) {
      const delay = opts.responseDelayMs ?? 200;
      setTimeout(() => {
        for (const r of opts.responses ?? []) {
          child.stdin.write(`${JSON.stringify(r)}\n`);
        }
      }, delay);
    }
  });
}

describe('echo-claude.ts fixture', () => {
  test('default prompt emits the M3a-era scripted scene plus a system/init catalog at startup', async () => {
    const events = await runFixture({ prompt: 'hello' });
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('session.started');
    expect(types).toContain('system'); // M3b.2 catalog at startup
    expect(types).toContain('agent.thinking');
    expect(types).toContain('tool.started');
    expect(types).toContain('tool.completed');
    expect(types).toContain('subagent.dispatched');
    expect(types).toContain('subagent.completed');
    expect(types).toContain('file.changed');
    expect(types).toContain('tokens.updated');
    expect(types).toContain('agent.message');
    // Permission events should NOT be in the default scene
    expect(types).not.toContain('permission.requested');
    expect(types).not.toContain('permission.resolved');
  });

  test('startup system/init line carries the hardcoded test catalog', async () => {
    // Send no prompt — the runFixture timeout fires after the startup
    // emissions land. The assertion targets the startup system/init line by
    // subtype filter so trailing default-scene events would not interfere
    // anyway.
    const events = await runFixture({ timeoutMs: 500 });
    const initLine = events.find(
      (e) =>
        (e as { type: string }).type === 'system' && (e as { subtype?: string }).subtype === 'init',
    ) as
      | {
          skills: string[];
          slash_commands: string[];
          agents: string[];
          plugins: unknown[];
        }
      | undefined;
    expect(initLine).toBeDefined();
    expect(initLine?.skills).toContain('plugin-a:test-skill');
    expect(initLine?.slash_commands).toContain('plugin-a:test-cmd');
    expect(initLine?.agents).toContain('test-agent');
    expect(Array.isArray(initLine?.plugins)).toBe(true);
  });

  test('/permission-test sentinel emits permission.requested only (no default scene)', async () => {
    const events = await runFixture({ prompt: '/permission-test' });
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('permission.requested');
    expect(types).toContain('system'); // startup init line is always present
    // Sentinel should NOT trigger the default scene
    expect(types).not.toContain('agent.thinking');
    expect(types).not.toContain('subagent.dispatched');
    // No resolved yet (host hasn't responded)
    expect(types).not.toContain('permission.resolved');
  });

  test('permission_response on stdin produces matching permission.resolved', async () => {
    // First prompt to discover the requestId, then send the response.
    // We can't read the requestId in advance, so we eavesdrop via timing:
    // wait 200ms after sending the prompt, then send a response that
    // matches "req-fake-1" (the fixture starts the counter at 0 and
    // increments before generating the id).
    const events = await runFixture({
      prompt: '/permission-test',
      responses: [{ type: 'permission_response', request_id: 'req-fake-1', decision: 'allow' }],
      responseDelayMs: 200,
      timeoutMs: 1500,
    });
    const requested = events.find((e) => (e as { type: string }).type === 'permission.requested');
    const resolved = events.find((e) => (e as { type: string }).type === 'permission.resolved');
    expect(requested).toBeDefined();
    expect(resolved).toBeDefined();
    if (resolved && (resolved as { type: string }).type === 'permission.resolved') {
      expect((resolved as { decision: string }).decision).toBe('allow');
    }
  });

  test('unknown request_id in permission_response is ignored (no resolved emitted)', async () => {
    const events = await runFixture({
      prompt: '/permission-test',
      responses: [{ type: 'permission_response', request_id: 'unknown-req', decision: 'allow' }],
      responseDelayMs: 200,
      timeoutMs: 1500,
    });
    const resolved = events.find((e) => (e as { type: string }).type === 'permission.resolved');
    expect(resolved).toBeUndefined();
  });
});

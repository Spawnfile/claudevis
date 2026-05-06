import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import { spawnSubprocess } from '../src/subprocess.js';

const FAKE = resolve(__dirname, 'fixtures/echo-claude.ts');

describe('spawnSubprocess', () => {
  it('emits parsed JSON lines from stdout', async () => {
    const sub = spawnSubprocess({ command: 'bun', args: [FAKE], cwd: process.cwd() });
    const lines: unknown[] = [];
    sub.onLine((line) => lines.push(line));

    // wait for the initial session.started
    await new Promise((r) => setTimeout(r, 200));

    sub.write({ type: 'user.prompt', content: 'hello' });
    await new Promise((r) => setTimeout(r, 200));

    await sub.close();
    expect(lines).toContainEqual({
      type: 'session.started',
      name: 'fake',
      cwd: process.cwd(),
      model: 'fake-model',
    });
    expect(lines).toContainEqual({
      type: 'agent.message',
      content: 'echo: hello',
      streaming: false,
    });
  });
});

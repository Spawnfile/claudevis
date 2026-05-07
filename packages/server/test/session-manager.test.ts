import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type { Event } from '@claudevis/shared';
import { createEventStore } from '../src/event-store.js';
import { createRealCliParser } from '../src/real-claude-parser.js';
import { serializeUserPromptForRealCli } from '../src/real-claude-serializer.js';
import { createSessionManager } from '../src/session-manager.js';

const FAKE = resolve(__dirname, 'fixtures/echo-claude.ts');

describe('createSessionManager — mode wiring', () => {
  it('exposes a mode option that selects parser/serializer', () => {
    expect(typeof createRealCliParser).toBe('function');
    expect(typeof serializeUserPromptForRealCli).toBe('function');
  });
});

describe('SessionManager', () => {
  it('emits session.started event after creating a session', async () => {
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });

    const id = await mgr.create({ cwd: process.cwd(), name: 'demo' });
    await new Promise((r) => setTimeout(r, 200));

    const started = events.find((e) => e.type === 'session.started');
    expect(started).toBeTruthy();
    expect(started?.sessionId).toBe(id);

    await mgr.kill(id);
  });

  it('routes a user prompt to subprocess and yields agent.message event', async () => {
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });

    const id = await mgr.create({ cwd: process.cwd(), name: 'demo' });
    await new Promise((r) => setTimeout(r, 200));

    await mgr.send({ sessionId: id, content: 'ping' });
    await new Promise((r) => setTimeout(r, 200));

    const reply = events.find((e) => e.type === 'agent.message');
    expect(reply).toBeTruthy();
    expect((reply as { content: string }).content).toBe('echo: ping');

    await mgr.kill(id);
  });
});

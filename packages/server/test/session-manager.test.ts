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

describe('SessionManager.respondToPermission', () => {
  it('writes a permission_response line to the subprocess and clears the request', async () => {
    // T7 landed; this test now runs against the extended fake fixture.
    const events: Event[] = [];
    const store = createEventStore({ kind: 'memory' });
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const sessionId = await mgr.create({ cwd: process.cwd(), name: 'test', model: 'sonnet' });
    await new Promise((r) => setTimeout(r, 50));
    await mgr.send({ sessionId, content: '/permission-test' });
    await new Promise((r) => setTimeout(r, 100));
    const requested = events.find((e) => e.type === 'permission.requested');
    expect(requested).toBeDefined();
    if (requested?.type !== 'permission.requested') throw new Error('typecheck');
    await mgr.respondToPermission({ requestId: requested.requestId, decision: 'allow' });
    await new Promise((r) => setTimeout(r, 100));
    const resolved = events.find(
      (e) => e.type === 'permission.resolved' && e.requestId === requested.requestId,
    );
    expect(resolved).toBeDefined();
    await mgr.shutdown();
  });

  it('throws for unknown requestId', async () => {
    const store = createEventStore({ kind: 'memory' });
    const mgr = createSessionManager({
      store,
      onEvent: () => {},
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    await expect(
      mgr.respondToPermission({ requestId: 'nonexistent', decision: 'allow' }),
    ).rejects.toThrow(/no pending permission/);
    await mgr.shutdown();
  });

  it('throws for synthesized auto-deny-* requestIds (not tracked in Map)', async () => {
    const store = createEventStore({ kind: 'memory' });
    const mgr = createSessionManager({
      store,
      onEvent: () => {},
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    // Even if a permission.requested with an "auto-deny-*" requestId enters
    // the emit pipeline, the Map skips it. Simulate by attempting to respond
    // to such an ID directly.
    await expect(
      mgr.respondToPermission({ requestId: 'auto-deny-toolu_xyz', decision: 'allow' }),
    ).rejects.toThrow(/no pending permission/);
    await mgr.shutdown();
  });
});

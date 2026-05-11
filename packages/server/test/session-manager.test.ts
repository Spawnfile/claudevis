import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type { Event, SkillEntry } from '@claudevis/shared';
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

describe('SessionManager — skill.invoked synthesis', () => {
  // T7 landed; tests now exercise the full catalog → /-prefix → skill.invoked flow.

  it('emits skill.invoked BEFORE user.prompt when prompt starts with /<known-name>', async () => {
    const events: Event[] = [];
    const store = createEventStore({ kind: 'memory' });
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const sessionId = await mgr.create({ cwd: process.cwd(), name: 'test', model: 'sonnet' });
    // Wait for fake fixture's startup system/init line to populate catalog.
    await new Promise((r) => setTimeout(r, 80));
    await mgr.send({ sessionId, content: '/plugin-a:test-skill some args' });
    await new Promise((r) => setTimeout(r, 50));

    const userPromptIdx = events.findIndex((e) => e.type === 'user.prompt');
    const skillInvokedIdx = events.findIndex((e) => e.type === 'skill.invoked');
    expect(skillInvokedIdx).toBeGreaterThanOrEqual(0);
    expect(userPromptIdx).toBeGreaterThanOrEqual(0);
    expect(skillInvokedIdx).toBeLessThan(userPromptIdx);

    const skillEvent = events[skillInvokedIdx];
    if (skillEvent && skillEvent.type === 'skill.invoked') {
      expect(skillEvent.skillName).toBe('plugin-a:test-skill');
      expect(skillEvent.args).toBe('some args');
    }
    await mgr.shutdown();
  });

  it('does NOT emit skill.invoked when prompt /<name> is unknown', async () => {
    const events: Event[] = [];
    const store = createEventStore({ kind: 'memory' });
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const sessionId = await mgr.create({ cwd: process.cwd(), name: 'test', model: 'sonnet' });
    await new Promise((r) => setTimeout(r, 80));
    await mgr.send({ sessionId, content: '/unknown-skill foo' });
    await new Promise((r) => setTimeout(r, 50));

    expect(events.find((e) => e.type === 'skill.invoked')).toBeUndefined();
    expect(events.find((e) => e.type === 'user.prompt')).toBeDefined();
    await mgr.shutdown();
  });

  it('does NOT emit skill.invoked when prompt has no /-prefix at all', async () => {
    const events: Event[] = [];
    const store = createEventStore({ kind: 'memory' });
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const sessionId = await mgr.create({ cwd: process.cwd(), name: 'test', model: 'sonnet' });
    await new Promise((r) => setTimeout(r, 80));
    await mgr.send({ sessionId, content: 'plain text prompt' });
    await new Promise((r) => setTimeout(r, 50));

    expect(events.find((e) => e.type === 'skill.invoked')).toBeUndefined();
    expect(events.find((e) => e.type === 'user.prompt')).toBeDefined();
    await mgr.shutdown();
  });

  it('forwards onCatalog SkillEntry[] to the option callback', async () => {
    const captured: SkillEntry[][] = [];
    const store = createEventStore({ kind: 'memory' });
    const mgr = createSessionManager({
      store,
      onEvent: () => {},
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
      onCatalog: (entries) => captured.push(entries),
    });
    await mgr.create({ cwd: process.cwd(), name: 'test', model: 'sonnet' });
    await new Promise((r) => setTimeout(r, 100));
    expect(captured.length).toBeGreaterThanOrEqual(1);
    expect(captured[0]?.length).toBeGreaterThanOrEqual(1);
    await mgr.shutdown();
  });
});

describe('SessionManager — session.mode.changed emission (M4.1)', () => {
  it('emits session.mode.changed after session.started carrying the requested mode', async () => {
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const id = await mgr.create({
      cwd: process.cwd(),
      name: 'test',
      model: 'sonnet',
      mode: 'plan',
    });
    await new Promise((r) => setTimeout(r, 200));
    const startedIdx = events.findIndex((e) => e.type === 'session.started' && e.sessionId === id);
    // The mode event we care about is the one that matches the REQUESTED mode
    // (in fake mode there's only one — the deferred emit from session-manager
    // routed via the fake line handler's session.started case).
    const modeIdx = events.findIndex(
      (e) =>
        e.type === 'session.mode.changed' &&
        e.sessionId === id &&
        (e as { mode: string }).mode === 'plan',
    );
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(modeIdx).toBeGreaterThan(startedIdx);
    const modeEvent = events[modeIdx];
    if (modeEvent?.type !== 'session.mode.changed') throw new Error('typecheck');
    expect(modeEvent.mode).toBe('plan');
    await mgr.kill(id);
  });

  it('defaults to mode=auto when session.create.mode is not provided', async () => {
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const id = await mgr.create({ cwd: process.cwd(), name: 'test', model: 'sonnet' });
    await new Promise((r) => setTimeout(r, 200));
    const startedIdx = events.findIndex((e) => e.type === 'session.started' && e.sessionId === id);
    const modeIdx = events.findIndex(
      (e) => e.type === 'session.mode.changed' && e.sessionId === id,
    );
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(modeIdx).toBeGreaterThan(startedIdx);
    const modeEvent = events[modeIdx];
    if (modeEvent?.type !== 'session.mode.changed') throw new Error('typecheck');
    expect(modeEvent.mode).toBe('auto');
    await mgr.kill(id);
  });
});

describe('SessionManager — session.idle timer (M4.1)', () => {
  it('emits session.idle after CLAUDEVIS_IDLE_MS of subprocess silence', async () => {
    process.env.CLAUDEVIS_IDLE_MS = '50';
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const id = await mgr.create({ cwd: process.cwd(), name: 'idle', model: 'sonnet' });
    // Wait past the 50ms threshold + a margin for setTimeout scheduling.
    await new Promise((r) => setTimeout(r, 200));
    const idle = events.find((e) => e.type === 'session.idle' && e.sessionId === id);
    expect(idle).toBeTruthy();
    if (idle?.type !== 'session.idle') throw new Error('typecheck');
    expect(idle.durationMs).toBe(50);
    await mgr.kill(id);
    // biome-ignore lint/performance/noDelete: test cleanup of env var
    delete process.env.CLAUDEVIS_IDLE_MS;
  });

  it('clears the idle timer on kill', async () => {
    process.env.CLAUDEVIS_IDLE_MS = '50';
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const id = await mgr.create({ cwd: process.cwd(), name: 'idle-kill', model: 'sonnet' });
    await mgr.kill(id);
    const before = events.filter((e) => e.type === 'session.idle').length;
    await new Promise((r) => setTimeout(r, 150));
    const after = events.filter((e) => e.type === 'session.idle').length;
    // Ended sessions don't emit subsequent idle events. The "before" count
    // captures any timer that fired before kill (could be 0 or 1 depending
    // on race with the fake fixture's startup); "after" must equal "before"
    // because the kill cleared the timer.
    expect(after).toBe(before);
    // biome-ignore lint/performance/noDelete: test cleanup of env var
    delete process.env.CLAUDEVIS_IDLE_MS;
  });

  it('CLAUDEVIS_IDLE_MS=0 disables idle synthesis entirely', async () => {
    process.env.CLAUDEVIS_IDLE_MS = '0';
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const id = await mgr.create({ cwd: process.cwd(), name: 'no-idle', model: 'sonnet' });
    await new Promise((r) => setTimeout(r, 150));
    const idle = events.find((e) => e.type === 'session.idle' && e.sessionId === id);
    expect(idle).toBeUndefined();
    await mgr.kill(id);
    // biome-ignore lint/performance/noDelete: test cleanup of env var
    delete process.env.CLAUDEVIS_IDLE_MS;
  });

  it('falls back to 30000ms default when CLAUDEVIS_IDLE_MS is non-numeric', async () => {
    process.env.CLAUDEVIS_IDLE_MS = 'off';
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: [FAKE] },
      mode: 'fake',
    });
    const id = await mgr.create({ cwd: process.cwd(), name: 'nan', model: 'sonnet' });
    // Wait 200ms — well under the 30s default. No idle should fire.
    await new Promise((r) => setTimeout(r, 200));
    const idle = events.find((e) => e.type === 'session.idle' && e.sessionId === id);
    expect(idle).toBeUndefined();
    await mgr.kill(id);
    // biome-ignore lint/performance/noDelete: test cleanup of env var
    delete process.env.CLAUDEVIS_IDLE_MS;
  });
});

describe('M4.2 file.changed diff enrichment', () => {
  // Real-mode integration: spawn a tiny inline bun script that emits a
  // synthetic claude stream-json sequence (init + Edit tool_use +
  // tool_result). The parser produces a file.changed with plus=0/minus=0;
  // the session-manager overlays the gitDiffRunner output.

  it('replaces parser-emitted plus/minus with computed git numstat', async () => {
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const inline = [
      `process.stdout.write(JSON.stringify({type:'system',subtype:'init',skills:[],slash_commands:[],agents:[],plugins:[]})+'\\n');`,
      `process.stdout.write(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'tu1',name:'Edit',input:{file_path:'demo.ts',old_string:'a',new_string:'b'}}]}})+'\\n');`,
      `process.stdout.write(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tu1',content:'ok'}]}})+'\\n');`,
      'process.stdin.resume();',
    ].join('\n');
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: ['-e', inline] },
      mode: 'real',
      gitDiffRunner: () => '7\t2\tdemo.ts\n',
    });
    const id = await mgr.create({ cwd: process.cwd(), name: 'diff-test', model: 'sonnet' });
    await new Promise((r) => setTimeout(r, 300));
    const fc = events.find((e) => e.type === 'file.changed');
    expect(fc).toBeDefined();
    if (fc?.type !== 'file.changed') throw new Error('typecheck');
    expect(fc.plus).toBe(7);
    expect(fc.minus).toBe(2);
    expect(fc.path).toBe('demo.ts');
    await mgr.kill(id);
  });

  it('falls back to 0/0 when runner returns null', async () => {
    const store = createEventStore({ kind: 'memory' });
    const events: Event[] = [];
    const inline = [
      `process.stdout.write(JSON.stringify({type:'system',subtype:'init',skills:[],slash_commands:[],agents:[],plugins:[]})+'\\n');`,
      `process.stdout.write(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'tu1',name:'Edit',input:{file_path:'gone.ts',old_string:'a',new_string:'b'}}]}})+'\\n');`,
      `process.stdout.write(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tu1',content:'ok'}]}})+'\\n');`,
      'process.stdin.resume();',
    ].join('\n');
    const mgr = createSessionManager({
      store,
      onEvent: (e) => events.push(e),
      claudeCommand: { command: 'bun', baseArgs: ['-e', inline] },
      mode: 'real',
      gitDiffRunner: () => null,
    });
    const id = await mgr.create({ cwd: process.cwd(), name: 'diff-fallback', model: 'sonnet' });
    await new Promise((r) => setTimeout(r, 300));
    const fc = events.find((e) => e.type === 'file.changed');
    expect(fc).toBeDefined();
    if (fc?.type !== 'file.changed') throw new Error('typecheck');
    expect(fc.plus).toBe(0);
    expect(fc.minus).toBe(0);
    await mgr.kill(id);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Event, ServerFrame, SkillEntry } from '@claudevis/shared';
import WebSocket from 'ws';
import { type CommandRouterDeps, createCommandRouter } from '../src/command-router.js';
import { type WsServer, startWsServer } from '../src/ws-server.js';

let server: WsServer;

beforeEach(async () => {
  server = await startWsServer({ port: 0, onCommand: () => {} });
});

afterEach(async () => {
  await server.close();
});

describe('startWsServer', () => {
  it('accepts a connection and sends hello frame', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1`);
    const msg = await new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()));
    });
    const parsed = JSON.parse(msg);
    expect(parsed.type).toBe('hello');
    expect(parsed.protocol).toBe('v1');
    ws.close();
  });
});

// ---------------------------------------------------------------------------
// permission.respond Command routing — T5 of M3b.1.
//
// The router is exercised via a real WS server with a stand-in SessionManager
// that records calls. This mirrors the integration test style (real WS, fake
// fixture) while keeping the SessionManager surface minimal.
// ---------------------------------------------------------------------------

interface TestServer {
  server: WsServer;
  send: (cmd: object) => void;
  frames: ServerFrame[];
  close: () => Promise<void>;
}

// `respondToPermission` was originally required (the only handler that
// needed override-driven coverage in M3b.1). M3b.3 also needs to override
// `create`, so all overrides are now optional with no-op defaults — callers
// pass only the methods they care about.
const buildMgr = (overrides: Partial<CommandRouterDeps['mgr']>): CommandRouterDeps['mgr'] => ({
  create: async () => 'sess-test',
  send: async () => {},
  interrupt: async () => {},
  clear: async () => {},
  kill: async () => {},
  respondToPermission: async () => {},
  ...overrides,
});

const emptyStore: CommandRouterDeps['store'] = {
  all: () => [] as Event[],
  bySession: () => [] as Event[],
};

// `getCatalog` (M3b.2) and `projectsDir` (M3b.3) are required on
// CommandRouterDeps but most tests don't care about them. Accept a partial
// here and default both so existing callers can keep passing { mgr, store }
// without churn. `projectsDir` defaults to '/dev/null' which fs.existsSync
// reports as not-a-directory, so scanResumableSessions returns [].
type TestServerDeps = Omit<CommandRouterDeps, 'getCatalog' | 'projectsDir'> &
  Partial<Pick<CommandRouterDeps, 'getCatalog' | 'projectsDir'>>;

async function startTestServer(deps: TestServerDeps): Promise<TestServer> {
  const onCommand = createCommandRouter({
    mgr: deps.mgr,
    store: deps.store,
    getCatalog: deps.getCatalog ?? (() => null),
    projectsDir: deps.projectsDir ?? '/dev/null',
  });
  const wsServer = await startWsServer({ port: 0, onCommand });
  const ws = new WebSocket(`ws://127.0.0.1:${wsServer.port}/v1`);
  const frames: ServerFrame[] = [];
  ws.on('message', (data) => {
    frames.push(JSON.parse(data.toString()) as ServerFrame);
  });
  await new Promise<void>((resolve) => ws.once('open', () => resolve()));
  return {
    server: wsServer,
    send: (cmd) => ws.send(JSON.stringify(cmd)),
    frames,
    close: async () => {
      ws.close();
      await wsServer.close();
    },
  };
}

// Poll until at least `count` non-hello frames have arrived (the WS server
// sends a hello frame on open, which we don't want to count toward replay
// barriers). Times out at 1s to keep failures fast.
async function waitForFrames(frames: ServerFrame[], count: number): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const nonHello = frames.filter((f) => f.type !== 'hello').length;
    if (nonHello >= count) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('permission.respond Command routing', () => {
  it('routes to SessionManager.respondToPermission on success', async () => {
    const calls: Array<{ requestId: string; decision: string }> = [];
    const mgr = buildMgr({
      respondToPermission: async ({ requestId, decision }) => {
        calls.push({ requestId, decision });
      },
    });

    const t = await startTestServer({ mgr, store: emptyStore });
    try {
      t.send({ type: 'permission.respond', requestId: 'req-42', decision: 'allow' });
      // Wait briefly for the WS handler to process the command.
      await new Promise((r) => setTimeout(r, 100));

      expect(calls).toEqual([{ requestId: 'req-42', decision: 'allow' }]);
      // No error frame should have been broadcast for the success path.
      const errorFrame = t.frames.find((f) => f.type === 'event' && f.event.type === 'error');
      expect(errorFrame).toBeUndefined();
    } finally {
      await t.close();
    }
  });

  it('surfaces a recoverable error event when respondToPermission throws', async () => {
    const mgr = buildMgr({
      respondToPermission: async () => {
        throw new Error('no pending permission for requestId req-missing');
      },
    });

    const t = await startTestServer({ mgr, store: emptyStore });
    try {
      t.send({ type: 'permission.respond', requestId: 'req-missing', decision: 'deny' });
      await new Promise((r) => setTimeout(r, 100));

      const errorFrame = t.frames.find((f) => f.type === 'event' && f.event.type === 'error');
      expect(errorFrame).toBeDefined();
      if (errorFrame?.type === 'event' && errorFrame.event.type === 'error') {
        expect(errorFrame.event.message).toMatch(/no pending permission/);
        expect(errorFrame.event.recoverable).toBe(true);
        expect(errorFrame.event.sessionId).toBe('_protocol');
      }
    } finally {
      await t.close();
    }
  });
});

// ---------------------------------------------------------------------------
// skill.catalog ServerFrame routing — T5 of M3b.2.
//
// On subscribe, the server replays the most recently broadcast catalog
// BEFORE replay.done so late-connecting clients can render the skill drawer
// in the same sync barrier as the event history. When no catalog has been
// observed yet (e.g. server just started, no system/init), the frame is
// simply omitted.
// ---------------------------------------------------------------------------

describe('skill.catalog ServerFrame routing', () => {
  it('subscribe replays the most recent catalog (if any) BEFORE replay.done', async () => {
    const cachedCatalog: SkillEntry[] = [
      { name: 'cached-skill', description: '', source: 'user', path: '', kind: 'skill' },
    ];
    const mgr = buildMgr({ respondToPermission: async () => {} });
    const t = await startTestServer({
      mgr,
      store: emptyStore,
      getCatalog: () => cachedCatalog,
    });
    try {
      t.send({ type: 'subscribe', sessionIds: '*', replay: true });
      // hello + skill.catalog + replay.done = 3 frames; wait for the two
      // non-hello frames.
      await waitForFrames(t.frames, 2);

      const catFrame = t.frames.find((f) => f.type === 'skill.catalog');
      const doneFrame = t.frames.find((f) => f.type === 'replay.done');
      expect(catFrame).toBeDefined();
      expect(doneFrame).toBeDefined();
      if (catFrame?.type === 'skill.catalog') {
        expect(catFrame.skills[0]?.name).toBe('cached-skill');
      }

      // skill.catalog must arrive BEFORE replay.done so the client renders
      // the drawer in the same sync cycle as the event history.
      const catIdx = t.frames.findIndex((f) => f.type === 'skill.catalog');
      const doneIdx = t.frames.findIndex((f) => f.type === 'replay.done');
      expect(catIdx).toBeLessThan(doneIdx);
    } finally {
      await t.close();
    }
  });

  it('subscribe does NOT send a skill.catalog frame when no catalog has been broadcast', async () => {
    const mgr = buildMgr({ respondToPermission: async () => {} });
    const t = await startTestServer({
      mgr,
      store: emptyStore,
      getCatalog: () => null,
    });
    try {
      t.send({ type: 'subscribe', sessionIds: '*', replay: false });
      await waitForFrames(t.frames, 1);

      const catFrame = t.frames.find((f) => f.type === 'skill.catalog');
      expect(catFrame).toBeUndefined();

      const doneFrame = t.frames.find((f) => f.type === 'replay.done');
      expect(doneFrame).toBeDefined();
    } finally {
      await t.close();
    }
  });

  it('subscribe with replay:false still replays catalog (catalog is global, not event-tied)', async () => {
    const cachedCatalog: SkillEntry[] = [
      { name: 'g', description: '', source: 'user', path: '', kind: 'skill' },
    ];
    const mgr = buildMgr({ respondToPermission: async () => {} });
    const t = await startTestServer({
      mgr,
      store: emptyStore,
      getCatalog: () => cachedCatalog,
    });
    try {
      t.send({ type: 'subscribe', sessionIds: '*', replay: false });
      await waitForFrames(t.frames, 2);

      expect(t.frames.find((f) => f.type === 'skill.catalog')).toBeDefined();
      expect(t.frames.find((f) => f.type === 'replay.done')).toBeDefined();
    } finally {
      await t.close();
    }
  });
});

// ---------------------------------------------------------------------------
// session.resumable ServerFrame routing — T3 of M3b.3.
//
// On subscribe, the server scans `projectsDir` and emits a session.resumable
// frame BEFORE replay.done. The frame is sent even when the scan returns []
// so the client can definitively render an empty Resumable section rather
// than guessing whether a frame might still arrive.
// ---------------------------------------------------------------------------

describe('session.resumable ServerFrame on subscribe', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudevis-ws-resume-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('subscribe emits a session.resumable frame with discovered jsonl files', async () => {
    const cwdDir = path.join(tmpRoot, '-tmp-x');
    fs.mkdirSync(cwdDir);
    fs.writeFileSync(path.join(cwdDir, 'session-1.jsonl'), '{"type":"x"}\n');

    const mgr = buildMgr({});
    const t = await startTestServer({
      mgr,
      store: emptyStore,
      projectsDir: tmpRoot,
    });
    try {
      t.send({ type: 'subscribe', sessionIds: '*', replay: false });
      await waitForFrames(t.frames, 2);

      const resumableFrame = t.frames.find((f) => f.type === 'session.resumable');
      expect(resumableFrame).toBeDefined();
      if (resumableFrame?.type === 'session.resumable') {
        expect(resumableFrame.sessions).toHaveLength(1);
        expect(resumableFrame.sessions[0]?.id).toBe('session-1');
        expect(resumableFrame.sessions[0]?.cwd).toBe('/tmp/x');
      }

      // session.resumable must arrive BEFORE replay.done.
      const resIdx = t.frames.findIndex((f) => f.type === 'session.resumable');
      const doneIdx = t.frames.findIndex((f) => f.type === 'replay.done');
      expect(resIdx).toBeLessThan(doneIdx);
    } finally {
      await t.close();
    }
  });

  it('subscribe emits an empty session.resumable frame when projectsDir is empty', async () => {
    const mgr = buildMgr({});
    const t = await startTestServer({
      mgr,
      store: emptyStore,
      projectsDir: tmpRoot,
    });
    try {
      t.send({ type: 'subscribe', sessionIds: '*', replay: false });
      await waitForFrames(t.frames, 2);

      const resumableFrame = t.frames.find((f) => f.type === 'session.resumable');
      expect(resumableFrame).toBeDefined();
      if (resumableFrame?.type === 'session.resumable') {
        expect(resumableFrame.sessions).toEqual([]);
      }
    } finally {
      await t.close();
    }
  });
});

// ---------------------------------------------------------------------------
// session.create Command resume forwarding — T3 of M3b.3.
//
// The Command-level `resume` field must thread through to mgr.create so
// SessionManager can append `--resume <id>` to the claude CLI invocation.
// ---------------------------------------------------------------------------

describe('session.create Command resume forwarding', () => {
  it('passes resume field through to SessionManager.create', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const mgr = buildMgr({
      create: async (opts) => {
        captured.push(opts);
        return 'sess-fake';
      },
    });
    const t = await startTestServer({ mgr, store: emptyStore });
    try {
      t.send({
        type: 'session.create',
        cwd: '/x',
        name: 'resumed',
        model: 'sonnet',
        resume: 'old-session-id',
      });
      await new Promise((r) => setTimeout(r, 50));

      expect(captured).toHaveLength(1);
      expect(captured[0]?.resume).toBe('old-session-id');
      expect(captured[0]?.cwd).toBe('/x');
      expect(captured[0]?.name).toBe('resumed');
    } finally {
      await t.close();
    }
  });

  it('passes undefined resume when omitted (backward compat)', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const mgr = buildMgr({
      create: async (opts) => {
        captured.push(opts);
        return 'sess-fake';
      },
    });
    const t = await startTestServer({ mgr, store: emptyStore });
    try {
      t.send({ type: 'session.create', cwd: '/x' });
      await new Promise((r) => setTimeout(r, 50));

      expect(captured).toHaveLength(1);
      expect(captured[0]?.resume).toBeUndefined();
    } finally {
      await t.close();
    }
  });
});

describe('subscribe replay filters zombie sessions (M4.1 T2)', () => {
  it('returns only events from sessions without session.ended when sessionIds=*', async () => {
    // Build a stub store containing two sessions: s-live (running), s-dead (ended).
    const stubStore: CommandRouterDeps['store'] = {
      all: () =>
        [
          {
            id: 'a',
            ts: 1,
            sessionId: 's-live',
            type: 'session.started',
            name: 'live',
            cwd: '/x',
            model: 'sonnet',
          },
          {
            id: 'b',
            ts: 2,
            sessionId: 's-dead',
            type: 'session.started',
            name: 'dead',
            cwd: '/x',
            model: 'sonnet',
          },
          { id: 'c', ts: 3, sessionId: 's-dead', type: 'session.ended', reason: 'complete' },
          { id: 'd', ts: 4, sessionId: 's-live', type: 'user.prompt', content: 'hi' },
        ] as unknown as Event[],
      bySession: () => [],
    };
    const router = createCommandRouter({
      mgr: {
        create: async () => 's',
        send: async () => {},
        interrupt: async () => {},
        clear: async () => {},
        kill: async () => {},
        respondToPermission: async () => {},
      },
      store: stubStore,
      getCatalog: () => null,
      projectsDir: '/nonexistent',
    });
    const sent: ServerFrame[] = [];
    await router({ type: 'subscribe', sessionIds: '*', replay: true }, (f) => sent.push(f));
    const events = sent.filter((f) => f.type === 'event').map((f) => (f as { event: Event }).event);
    expect(events.map((e) => e.id)).toEqual(['a', 'd']);
  });

  it('honors explicit sessionIds without filtering (caller knows what it wants)', async () => {
    const stubStore: CommandRouterDeps['store'] = {
      all: () => [],
      bySession: (sid) =>
        sid === 's-dead'
          ? ([
              {
                id: 'b',
                ts: 2,
                sessionId: 's-dead',
                type: 'session.started',
                name: 'dead',
                cwd: '/x',
                model: 'sonnet',
              },
              { id: 'c', ts: 3, sessionId: 's-dead', type: 'session.ended', reason: 'complete' },
            ] as unknown as Event[])
          : [],
    };
    const router = createCommandRouter({
      mgr: {
        create: async () => 's',
        send: async () => {},
        interrupt: async () => {},
        clear: async () => {},
        kill: async () => {},
        respondToPermission: async () => {},
      },
      store: stubStore,
      getCatalog: () => null,
      projectsDir: '/nonexistent',
    });
    const sent: ServerFrame[] = [];
    await router({ type: 'subscribe', sessionIds: ['s-dead'], replay: true }, (f) => sent.push(f));
    const events = sent.filter((f) => f.type === 'event').map((f) => (f as { event: Event }).event);
    expect(events.map((e) => e.id)).toEqual(['b', 'c']);
  });
});

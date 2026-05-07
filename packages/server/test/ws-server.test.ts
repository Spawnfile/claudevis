import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Event, ServerFrame } from '@claudevis/shared';
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

interface PartialMgr {
  respondToPermission: CommandRouterDeps['mgr']['respondToPermission'];
}

const buildMgr = (
  overrides: Partial<CommandRouterDeps['mgr']> & PartialMgr,
): CommandRouterDeps['mgr'] => ({
  create: async () => 'sess-test',
  send: async () => {},
  interrupt: async () => {},
  clear: async () => {},
  kill: async () => {},
  ...overrides,
});

const emptyStore: CommandRouterDeps['store'] = {
  all: () => [] as Event[],
  bySession: () => [] as Event[],
};

async function startTestServer(deps: CommandRouterDeps): Promise<TestServer> {
  const onCommand = createCommandRouter(deps);
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

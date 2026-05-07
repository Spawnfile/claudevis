import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type { Event, ServerFrame } from '@claudevis/shared';
import WebSocket from 'ws';
import { createEventStore } from '../src/event-store.js';
import { createSessionManager } from '../src/session-manager.js';
import { type WsServer, startWsServer } from '../src/ws-server.js';

const FAKE = resolve(__dirname, 'fixtures/echo-claude.ts');

let server: WsServer;
let mgr: ReturnType<typeof createSessionManager>;

beforeEach(async () => {
  const store = createEventStore({ kind: 'memory' });
  const broadcast = (frame: ServerFrame) => server.broadcast(frame);
  mgr = createSessionManager({
    store,
    onEvent: (e: Event) => broadcast({ type: 'event', event: e }),
    claudeCommand: { command: 'bun', baseArgs: [FAKE] },
    mode: 'fake',
  });
  server = await startWsServer({
    port: 0,
    onCommand: async (cmd, send) => {
      if (cmd.type === 'session.create') {
        await mgr.create({ cwd: cmd.cwd, name: cmd.name, model: cmd.model });
      } else if (cmd.type === 'session.send') {
        await mgr.send({ sessionId: cmd.sessionId, content: cmd.content });
      } else if (cmd.type === 'session.kill') {
        await mgr.kill(cmd.sessionId);
      } else if (cmd.type === 'subscribe') {
        if (cmd.replay) {
          const events =
            cmd.sessionIds === '*'
              ? store.all()
              : cmd.sessionIds.flatMap((sid) => store.bySession(sid));
          for (const ev of events) send({ type: 'event', event: ev });
        }
        send({ type: 'replay.done' });
      }
    },
  });
});

afterEach(async () => {
  await mgr.shutdown();
  await server.close();
});

describe('end-to-end (websocket → session manager → fake claude)', () => {
  it('relays prompt and receives echoed agent.message via websocket', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1`);
    const events: Event[] = [];
    let sessionId: string | undefined;

    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as ServerFrame;
      if (frame.type === 'event') {
        events.push(frame.event);
        if (frame.event.type === 'session.started') sessionId = frame.event.sessionId;
      }
    });

    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'session.create', cwd: process.cwd(), name: 'demo' }));

    // wait for session.started
    for (let i = 0; i < 30 && !sessionId; i++) await new Promise((r) => setTimeout(r, 50));
    expect(sessionId).toBeTruthy();

    ws.send(JSON.stringify({ type: 'session.send', sessionId, content: 'hello' }));

    // wait for agent.message
    let reply: Event | undefined;
    for (let i = 0; i < 40 && !reply; i++) {
      reply = events.find((e) => e.type === 'agent.message');
      if (!reply) await new Promise((r) => setTimeout(r, 50));
    }
    expect(reply).toBeTruthy();
    expect((reply as { content: string }).content).toBe('echo: hello');

    ws.send(JSON.stringify({ type: 'session.kill', sessionId }));
    ws.close();
  });

  it('fake-mode emits the full Event vocabulary after a prompt', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/v1`);
    const events: Event[] = [];
    let sessionId: string | undefined;

    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as ServerFrame;
      if (frame.type === 'event') {
        events.push(frame.event);
        if (frame.event.type === 'session.started') sessionId = frame.event.sessionId;
      }
    });

    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'session.create', cwd: process.cwd(), name: 'vocab-test' }));

    for (let i = 0; i < 30 && !sessionId; i++) await new Promise((r) => setTimeout(r, 50));
    expect(sessionId).toBeTruthy();

    ws.send(JSON.stringify({ type: 'session.send', sessionId, content: 'vocab' }));

    // Wait until agent.message arrives (it's last in the fixture's scripted scene)
    let gotMessage = false;
    for (let i = 0; i < 60 && !gotMessage; i++) {
      gotMessage = events.some((e) => e.type === 'agent.message');
      if (!gotMessage) await new Promise((r) => setTimeout(r, 50));
    }

    const types = new Set(events.map((e) => e.type));
    const required = [
      'session.started',
      'user.prompt',
      'agent.thinking',
      'tool.started',
      'tool.completed',
      'subagent.dispatched',
      'subagent.completed',
      'file.changed',
      'tokens.updated',
      'agent.message',
    ] as const;
    for (const t of required) {
      expect(types.has(t)).toBe(true);
    }

    ws.send(JSON.stringify({ type: 'session.kill', sessionId }));
    ws.close();
  });

  it('replays prior events to a fresh subscribe with replay:true', async () => {
    // First client: create a session and send a prompt to populate the store
    const ws1 = new WebSocket(`ws://127.0.0.1:${server.port}/v1`);
    let sessionId: string | undefined;
    let replayDone1 = false;
    ws1.on('message', (data) => {
      const f = JSON.parse(data.toString()) as ServerFrame;
      if (f.type === 'event' && f.event.type === 'session.started') sessionId = f.event.sessionId;
      if (f.type === 'replay.done') replayDone1 = true;
    });
    await new Promise((r) => ws1.once('open', r));
    ws1.send(JSON.stringify({ type: 'subscribe', sessionIds: '*', replay: true }));
    for (let i = 0; i < 20 && !replayDone1; i++) await new Promise((r) => setTimeout(r, 25));
    expect(replayDone1).toBe(true);

    ws1.send(JSON.stringify({ type: 'session.create', cwd: process.cwd(), name: 'rep' }));
    for (let i = 0; i < 30 && !sessionId; i++) await new Promise((r) => setTimeout(r, 50));
    ws1.send(JSON.stringify({ type: 'session.send', sessionId, content: 'hello' }));
    await new Promise((r) => setTimeout(r, 400));
    ws1.close();

    // Second client connects fresh, subscribes with replay:true, must
    // receive the events that were stored before it connected.
    const ws2 = new WebSocket(`ws://127.0.0.1:${server.port}/v1`);
    const replayed: Event[] = [];
    let replayDone2 = false;
    ws2.on('message', (data) => {
      const f = JSON.parse(data.toString()) as ServerFrame;
      if (f.type === 'event') replayed.push(f.event);
      if (f.type === 'replay.done') replayDone2 = true;
    });
    await new Promise((r) => ws2.once('open', r));
    ws2.send(JSON.stringify({ type: 'subscribe', sessionIds: '*', replay: true }));
    for (let i = 0; i < 40 && !replayDone2; i++) await new Promise((r) => setTimeout(r, 25));
    expect(replayDone2).toBe(true);
    expect(
      replayed.find((e) => e.type === 'session.started' && e.sessionId === sessionId),
    ).toBeTruthy();
    expect(replayed.find((e) => e.type === 'agent.message')).toBeTruthy();
    ws2.close();
  });
});

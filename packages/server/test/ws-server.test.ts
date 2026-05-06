import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import WebSocket from 'ws';
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

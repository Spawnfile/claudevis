import { randomUUID } from 'node:crypto';
import { type Command, CommandSchema, type ServerFrame } from '@claudevis/shared';
import { type WebSocket, WebSocketServer } from 'ws';

export interface WsServer {
  port: number;
  close: () => Promise<void>;
  broadcast: (frame: ServerFrame) => void;
}

export interface WsServerOptions {
  port: number;
  onCommand: (cmd: Command, send: (frame: ServerFrame) => void) => void | Promise<void>;
}

const SERVER_VERSION = '0.0.0';

export async function startWsServer(opts: WsServerOptions): Promise<WsServer> {
  const wss = new WebSocketServer({ port: opts.port, path: '/v1' });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    const send = (frame: ServerFrame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    ws.on('close', () => clients.delete(ws));
    ws.on('message', async (raw) => {
      let parsed: Command;
      try {
        parsed = CommandSchema.parse(JSON.parse(raw.toString()));
      } catch (err) {
        send({
          type: 'event',
          event: {
            id: `ev-${randomUUID().slice(0, 12)}`,
            ts: Date.now(),
            sessionId: '_protocol',
            type: 'error',
            message: `invalid command: ${(err as Error).message}`,
            recoverable: true,
          },
        });
        return;
      }
      try {
        await opts.onCommand(parsed, send);
      } catch (err) {
        send({
          type: 'event',
          event: {
            id: `ev-${randomUUID().slice(0, 12)}`,
            ts: Date.now(),
            sessionId: '_protocol',
            type: 'error',
            message: `command handler error: ${(err as Error).message}`,
            recoverable: true,
          },
        });
      }
    });
    send({ type: 'hello', protocol: 'v1', serverVersion: SERVER_VERSION });
  });

  await new Promise<void>((resolve) => wss.on('listening', resolve));
  const address = wss.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    port,
    close: () => {
      for (const c of clients) c.terminate();
      clients.clear();
      return new Promise<void>((resolve, reject) => {
        // Bun's ws compat layer may not invoke the wss.close callback after
        // all clients have been force-terminated, so we race against a
        // short-circuit resolve to avoid hanging afterEach hooks in tests.
        let settled = false;
        const settle = (err?: Error) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };
        wss.close((err) => settle(err ?? undefined));
        // Allow one event-loop turn for the callback, then resolve anyway.
        setImmediate(() => settle());
      });
    },
    broadcast: (frame) => {
      const text = JSON.stringify(frame);
      for (const c of clients) if (c.readyState === c.OPEN) c.send(text);
    },
  };
}

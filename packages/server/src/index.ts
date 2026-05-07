import { randomUUID } from 'node:crypto';
import type { Event, ServerFrame } from '@claudevis/shared';
import { createEventStore } from './event-store.js';
import { createSessionManager } from './session-manager.js';
import { startWsServer } from './ws-server.js';

const PORT = Number(process.env.CLAUDEVIS_PORT ?? 7878);
const DB_PATH = process.env.CLAUDEVIS_DB ?? './claudevis.sqlite';

// CLAUDEVIS_FAKE_CLAUDE=1 swaps to the fixture binary for local dev
const fake = process.env.CLAUDEVIS_FAKE_CLAUDE === '1';

// Resolve `claude` to an absolute path at startup so we don't fail at
// session.create time with a confusing ENOENT. Some shells (especially the
// ones spawned by IDE integrated terminals or some package-manager wrappers)
// do not have ~/.local/bin on PATH, even when an interactive shell does.
// CLAUDEVIS_CLAUDE_BIN overrides the lookup.
function resolveClaudeBin(): string | null {
  if (process.env.CLAUDEVIS_CLAUDE_BIN) return process.env.CLAUDEVIS_CLAUDE_BIN;
  const found = Bun.which('claude');
  return found ?? null;
}

let claudeCommand: { command: string; baseArgs: string[] };
if (fake) {
  claudeCommand = {
    command: 'bun',
    baseArgs: [new URL('../test/fixtures/echo-claude.ts', import.meta.url).pathname],
  };
} else {
  const bin = resolveClaudeBin();
  if (!bin) {
    console.error(
      '[claudevis] FATAL: `claude` binary not found on PATH.\n' +
        '  Either install the claude CLI and ensure it is on PATH, or set\n' +
        '  CLAUDEVIS_CLAUDE_BIN to its absolute path. To run claudevis without\n' +
        '  the real CLI, start in fake mode: CLAUDEVIS_FAKE_CLAUDE=1 ...',
    );
    process.exit(1);
  }
  console.log(`[claudevis] real-mode claude binary: ${bin}`);
  claudeCommand = {
    command: bin,
    // --verbose is REQUIRED alongside stream-json in non-print mode; without
    // it claude rejects with "stream-json requires --verbose".
    baseArgs: ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'],
  };
}

const store = createEventStore({ kind: 'sqlite', path: DB_PATH });

let serverRef: { broadcast: (f: ServerFrame) => void } | null = null;
const onEvent = (e: Event) => serverRef?.broadcast({ type: 'event', event: e });

const mgr = createSessionManager({ store, onEvent, claudeCommand, mode: fake ? 'fake' : 'real' });

// Exhaustiveness helper — flagged at compile time when a Command case is
// added to the protocol but forgotten here.
const assertNever = (x: never, _msg: string): never => {
  throw new Error(`${_msg}: ${JSON.stringify(x)}`);
};

const server = await startWsServer({
  port: PORT,
  onCommand: async (cmd, send) => {
    switch (cmd.type) {
      case 'session.create':
        await mgr.create({ cwd: cmd.cwd, name: cmd.name, model: cmd.model });
        return;
      case 'session.send':
        await mgr.send({ sessionId: cmd.sessionId, content: cmd.content });
        return;
      case 'session.interrupt':
        await mgr.interrupt(cmd.sessionId);
        return;
      case 'session.clear':
        await mgr.clear(cmd.sessionId);
        return;
      case 'session.kill':
        await mgr.kill(cmd.sessionId);
        return;
      case 'subscribe': {
        // Replay handshake — spec §4.1 / §4.4
        if (cmd.replay) {
          const events =
            cmd.sessionIds === '*'
              ? store.all()
              : cmd.sessionIds.flatMap((sid) => store.bySession(sid));
          for (const ev of events) send({ type: 'event', event: ev });
        }
        send({ type: 'replay.done' });
        return;
      }
      case 'session.setMode':
      case 'permission.respond':
      case 'skill.list':
      case 'skill.run':
      case 'skill.install':
      case 'settings.checkClaude':
      case 'settings.runLogin': {
        // Recognized in v1 protocol but implementation deferred to later
        // milestones. Surface as a non-fatal protocol error so the UI can
        // tell the user this command isn't wired yet.
        send({
          type: 'event',
          event: {
            id: `ev-${randomUUID().slice(0, 12)}`,
            ts: Date.now(),
            sessionId: '_protocol',
            type: 'error',
            message: `command "${cmd.type}" is in the v1 protocol but not implemented in M1`,
            recoverable: true,
          },
        });
        return;
      }
      default:
        return assertNever(cmd, 'unhandled command type');
    }
  },
});
serverRef = server;
console.log(`[claudevis] ws://127.0.0.1:${server.port}/v1`);

const shutdown = async () => {
  await mgr.shutdown();
  await server.close();
  store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

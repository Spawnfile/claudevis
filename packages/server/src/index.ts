import type { Event, ServerFrame } from '@claudevis/shared';
import { createCommandRouter } from './command-router.js';
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

const onCommand = createCommandRouter({ mgr, store });

const server = await startWsServer({
  port: PORT,
  onCommand,
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

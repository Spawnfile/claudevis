import { randomUUID } from 'node:crypto';
import type { Command, ServerFrame, SkillEntry } from '@claudevis/shared';
import type { EventStore } from './event-store.js';
import { filterZombieSessions } from './replay-filter.js';
import { scanResumableSessions } from './resume-scanner.js';
import type { SessionManager } from './session-manager.js';

// Exhaustiveness helper — flagged at compile time when a Command case is
// added to the protocol but forgotten here.
const assertNever = (x: never, _msg: string): never => {
  throw new Error(`${_msg}: ${JSON.stringify(x)}`);
};

export interface CommandRouterDeps {
  mgr: Pick<
    SessionManager,
    'create' | 'send' | 'interrupt' | 'clear' | 'kill' | 'respondToPermission'
  >;
  store: Pick<EventStore, 'all' | 'bySession'>;
  /**
   * M3b.2: returns the most recently broadcast catalog so subscribe can
   * replay it for late-connecting clients. Returns null when no system/init
   * has produced a catalog yet.
   */
  getCatalog: () => SkillEntry[] | null;
  /**
   * M3b.3: directory scanned for resumable sessions on every subscribe.
   * Default `~/.claude/projects/`; overridable via `CLAUDEVIS_PROJECTS_DIR`
   * env var (resolved in index.ts).
   */
  projectsDir: string;
}

export type CommandHandler = (cmd: Command, send: (frame: ServerFrame) => void) => Promise<void>;

const protocolErrorEvent = (message: string): ServerFrame => ({
  type: 'event',
  event: {
    id: `ev-${randomUUID().slice(0, 12)}`,
    ts: Date.now(),
    sessionId: '_protocol',
    type: 'error',
    message,
    recoverable: true,
  },
});

/**
 * Build the WS server's onCommand handler from a SessionManager + EventStore.
 *
 * Factored out of index.ts so tests can exercise routing with a stand-in
 * SessionManager (see ws-server.test.ts). index.ts wires the production
 * SessionManager and EventStore.
 */
export function createCommandRouter(deps: CommandRouterDeps): CommandHandler {
  const { mgr, store, getCatalog, projectsDir } = deps;
  return async (cmd, send) => {
    switch (cmd.type) {
      case 'session.create':
        await mgr.create({
          cwd: cmd.cwd,
          name: cmd.name,
          model: cmd.model,
          resume: cmd.resume,
          mode: cmd.mode,
        });
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
              ? filterZombieSessions(store.all())
              : cmd.sessionIds.flatMap((sid) => store.bySession(sid));
          for (const ev of events) send({ type: 'event', event: ev });
        }
        // M3b.2: replay the most recent catalog so late-connecting clients
        // see the skill drawer populated immediately. Sent BEFORE replay.done
        // so the client can render the drawer in the same sync barrier as
        // the event history. Skipped when no system/init has produced a
        // catalog yet (e.g. server just started, no sessions created).
        const catalog = getCatalog();
        if (catalog !== null) {
          send({ type: 'skill.catalog', skills: catalog });
        }
        // M3b.3: scan and emit resumable sessions BEFORE replay.done so the
        // client renders the Resumable section in the same sync barrier as
        // the event history and skill catalog. The scan is best-effort: if
        // projectsDir doesn't exist, scanResumableSessions returns [].
        const resumable = await scanResumableSessions({ projectsDir });
        send({ type: 'session.resumable', sessions: resumable });
        send({ type: 'replay.done' });
        return;
      }
      case 'permission.respond': {
        try {
          await mgr.respondToPermission({
            requestId: cmd.requestId,
            decision: cmd.decision,
          });
        } catch (err) {
          send(protocolErrorEvent((err as Error).message));
        }
        return;
      }
      case 'session.setMode':
      case 'skill.list':
      case 'skill.run':
      case 'skill.install':
      case 'settings.checkClaude':
      case 'settings.runLogin': {
        // Recognized in v1 protocol but implementation deferred to later
        // milestones. Surface as a non-fatal protocol error so the UI can
        // tell the user this command isn't wired yet.
        send(
          protocolErrorEvent(
            `command "${cmd.type}" is in the v1 protocol but not implemented in M1`,
          ),
        );
        return;
      }
      default:
        return assertNever(cmd, 'unhandled command type');
    }
  };
}

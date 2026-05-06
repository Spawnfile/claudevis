import { randomUUID } from 'node:crypto';
import type { Event } from '@claudevis/shared';
import type { EventStore } from './event-store.js';
import { detectGitInfo } from './git-info.js';
import { type SubprocessHandle, spawnSubprocess } from './subprocess.js';

export interface SessionManager {
  create(opts: { cwd: string; name?: string; model?: string }): Promise<string>;
  send(opts: { sessionId: string; content: string }): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  clear(sessionId: string): Promise<void>;
  kill(sessionId: string): Promise<void>;
  list(): string[];
  shutdown(): Promise<void>;
}

export interface SessionManagerOptions {
  store: EventStore;
  onEvent: (e: Event) => void;
  claudeCommand: { command: string; baseArgs: string[] };
}

interface SessionState {
  id: string;
  name: string;
  sub: SubprocessHandle;
  cwd: string;
  model: string;
  repo?: string;
  branch?: string;
}

const newId = () => `sess-${randomUUID().slice(0, 8)}`;
const newEventId = () => `ev-${randomUUID().slice(0, 12)}`;

export function createSessionManager(opts: SessionManagerOptions): SessionManager {
  const sessions = new Map<string, SessionState>();

  const emit = (e: Event) => {
    opts.store.append(e);
    opts.onEvent(e);
  };

  // Build the line handler outside the sub creation so it can be passed
  // EAGERLY into spawnSubprocess (see SubprocessOptions.onLine docstring).
  // This guarantees the very first line — typically `session.started` —
  // is never lost to a startup race.
  const makeLineHandler = (state: SessionState) => (raw: unknown) => {
    const line = raw as { type?: string } & Record<string, unknown>;
    if (typeof line.type !== 'string') return;
    const base = { id: newEventId(), ts: Date.now(), sessionId: state.id };
    // Pass through known shapes verbatim; unknown types become 'error'.
    switch (line.type) {
      case 'session.started': {
        emit({
          ...base,
          type: 'session.started',
          name: state.name,
          cwd: state.cwd,
          model: state.model,
          repo: state.repo,
          branch: state.branch,
        });
        return;
      }
      case 'agent.message': {
        emit({
          ...base,
          type: 'agent.message',
          content: String(line.content ?? ''),
          streaming: Boolean(line.streaming ?? false),
        });
        return;
      }
      case 'agent.thinking': {
        emit({
          ...base,
          type: 'agent.thinking',
          content: String(line.content ?? ''),
          streaming: Boolean(line.streaming ?? false),
        });
        return;
      }
      case 'tool.started': {
        emit({
          ...base,
          type: 'tool.started',
          callId: String(line.callId ?? newEventId()),
          name: String(line.name ?? 'unknown'),
          input: line.input ?? null,
        });
        return;
      }
      case 'tool.completed': {
        emit({
          ...base,
          type: 'tool.completed',
          callId: String(line.callId ?? ''),
          output: line.output ?? null,
          status: line.status === 'error' ? 'error' : 'ok',
          durationMs: Number(line.durationMs ?? 0),
        });
        return;
      }
      case 'subagent.dispatched': {
        emit({
          ...base,
          type: 'subagent.dispatched',
          parentCallId: String(line.parentCallId ?? ''),
          agentType: String(line.agentType ?? 'unknown'),
          prompt: String(line.prompt ?? ''),
          childSessionId: String(line.childSessionId ?? newEventId()),
        });
        return;
      }
      case 'subagent.completed': {
        emit({
          ...base,
          type: 'subagent.completed',
          parentCallId: String(line.parentCallId ?? ''),
          childSessionId: String(line.childSessionId ?? ''),
          result: line.result ?? null,
          status: line.status === 'error' ? 'error' : 'ok',
        });
        return;
      }
      case 'file.changed': {
        emit({
          ...base,
          type: 'file.changed',
          path: String(line.path ?? ''),
          plus: Number(line.plus ?? 0),
          minus: Number(line.minus ?? 0),
          preview: line.preview as string | undefined,
        });
        return;
      }
      case 'tokens.updated': {
        emit({
          ...base,
          type: 'tokens.updated',
          input: Number(line.input ?? 0),
          output: Number(line.output ?? 0),
          cached: Number(line.cached ?? 0),
          costUsd: Number(line.costUsd ?? 0),
          model: String(line.model ?? 'unknown'),
        });
        return;
      }
      case 'permission.requested': {
        emit({
          ...base,
          type: 'permission.requested',
          requestId: String(line.requestId ?? newEventId()),
          toolName: String(line.toolName ?? 'unknown'),
          toolInput: line.toolInput ?? null,
          preview: line.preview as string | undefined,
          callId: line.callId as string | undefined,
        });
        return;
      }
      case 'permission.resolved': {
        emit({
          ...base,
          type: 'permission.resolved',
          requestId: String(line.requestId ?? ''),
          decision:
            line.decision === 'allow' || line.decision === 'deny' || line.decision === 'always'
              ? line.decision
              : 'deny',
        });
        return;
      }
      case 'session.idle': {
        emit({
          ...base,
          type: 'session.idle',
          durationMs: Number(line.durationMs ?? 0),
        });
        return;
      }
      case 'skill.invoked': {
        emit({
          ...base,
          type: 'skill.invoked',
          skillName: String(line.skillName ?? ''),
          args: line.args as string | undefined,
        });
        return;
      }
      case 'error': {
        emit({
          ...base,
          type: 'error',
          message: String(line.message ?? 'unknown error'),
          recoverable: Boolean(line.recoverable ?? true),
        });
        return;
      }
      default: {
        // Unknown line — surface as a recoverable error so it's visible in
        // the UI rather than silently dropped. M2's real-claude parser
        // either maps the new shape or extends this switch.
        emit({
          ...base,
          type: 'error',
          message: `unknown stream-json line type: ${line.type}`,
          recoverable: true,
        });
      }
    }
  };

  const wireExit = (state: SessionState) => {
    state.sub.onExit((code) => {
      emit({
        id: newEventId(),
        ts: Date.now(),
        sessionId: state.id,
        type: 'session.ended',
        reason: code === 0 ? 'complete' : 'error',
        exitCode: code ?? undefined,
      });
      sessions.delete(state.id);
    });
  };

  return {
    create: async ({ cwd, name, model }) => {
      const id = newId();
      const resolvedModel = model ?? 'sonnet';
      const git = detectGitInfo(cwd);
      // Build state shell BEFORE spawn so the eager onLine handler closes
      // over a stable reference.
      const state: SessionState = {
        id,
        name: name ?? id,
        cwd,
        model: resolvedModel,
        repo: git.repo,
        branch: git.branch,
        // sub is filled in immediately below — declared here for type safety.
        // biome-ignore lint/suspicious/noExplicitAny: hole filled synchronously
        sub: undefined as any,
      };
      const lineHandler = makeLineHandler(state);
      state.sub = spawnSubprocess({
        command: opts.claudeCommand.command,
        args: opts.claudeCommand.baseArgs,
        cwd,
        onLine: lineHandler,
      });
      sessions.set(id, state);
      wireExit(state);
      return id;
    },
    send: async ({ sessionId, content }) => {
      const s = sessions.get(sessionId);
      if (!s) throw new Error(`no session ${sessionId}`);
      emit({
        id: newEventId(),
        ts: Date.now(),
        sessionId,
        type: 'user.prompt',
        content,
      });
      s.sub.write({ type: 'user.prompt', content });
    },
    interrupt: async (sessionId) => {
      const s = sessions.get(sessionId);
      if (!s) throw new Error(`no session ${sessionId}`);
      s.sub.signal('SIGINT');
      emit({
        id: newEventId(),
        ts: Date.now(),
        sessionId,
        type: 'interrupt.signaled',
      });
    },
    clear: async (sessionId) => {
      const s = sessions.get(sessionId);
      if (!s) throw new Error(`no session ${sessionId}`);
      // For walking skeleton we model `/clear` as sending the literal text.
      // Real-claude integration in M2 will use the proper SDK semantics.
      s.sub.write({ type: 'user.prompt', content: '/clear' });
    },
    kill: async (sessionId) => {
      const s = sessions.get(sessionId);
      if (!s) return;
      await s.sub.close();
    },
    list: () => Array.from(sessions.keys()),
    shutdown: async () => {
      await Promise.all(Array.from(sessions.values()).map((s) => s.sub.close()));
      sessions.clear();
    },
  };
}

import { randomUUID } from 'node:crypto';
import type { Event, PermissionMode, SkillEntry } from '@claudevis/shared';
import { buildSkillEntries, extractInvokableNames } from './catalog.js';
import type { EventStore } from './event-store.js';
import { detectGitInfo } from './git-info.js';
import { type ParserContext, createRealCliParser } from './real-claude-parser.js';
import { serializeUserPromptForRealCli } from './real-claude-serializer.js';
import { buildSpawnArgs, expandTilde } from './spawn-args.js';
import { type SubprocessHandle, spawnSubprocess } from './subprocess.js';

export interface SessionManager {
  create(opts: {
    cwd: string;
    name?: string;
    model?: string;
    resume?: string;
    mode?: PermissionMode;
  }): Promise<string>;
  send(opts: { sessionId: string; content: string }): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  clear(sessionId: string): Promise<void>;
  kill(sessionId: string): Promise<void>;
  /**
   * Routes a permission decision back to the originating subprocess.
   * Throws if the requestId is not currently tracked (e.g., synthesized
   * auto-deny IDs are not tracked because nothing can respond to them).
   * Caller (WS server) should catch and surface as a recoverable error Event.
   */
  respondToPermission(opts: {
    requestId: string;
    decision: 'allow' | 'deny' | 'always';
  }): Promise<void>;
  list(): string[];
  shutdown(): Promise<void>;
}

export interface SessionManagerOptions {
  store: EventStore;
  onEvent: (e: Event) => void;
  claudeCommand: { command: string; baseArgs: string[] };
  /** 'real' parses claude stream-json; 'fake' passes through fixture lines. */
  mode: 'fake' | 'real';
  /**
   * M3b.2: called with the freshly-built SkillEntry[] whenever a session's
   * system/init line yields a catalog. WS server uses this to broadcast a
   * skill.catalog ServerFrame to all clients. Optional.
   */
  onCatalog?: (skills: SkillEntry[]) => void;
}

interface SessionState {
  id: string;
  name: string;
  sub: SubprocessHandle;
  cwd: string;
  model: string;
  repo?: string;
  branch?: string;
  /**
   * M3b.2: set populated from system/init catalog. Used in `send` to detect
   * /-prefix prompts that match a known skill/slash_command/agent and emit
   * skill.invoked before user.prompt.
   */
  knownInvokableNames: Set<string>;
  // M4.1: tracks the most recently emitted PermissionMode so a parser-side
  // system/init.permissionMode read can suppress duplicate emissions.
  lastMode: PermissionMode;
  // M4.1 (fake mode only): when set, the fake-mode line handler's
  // session.started case emits session.mode.changed{value} immediately
  // after the fixture's session.started passes through. Real mode never
  // sets this (session.mode.changed is emitted sync in create()). Cleared
  // to null after the deferred emit fires so subsequent session.started
  // events (theoretical: if fixture re-sends) don't re-emit.
  modeChangedDeferred: PermissionMode | null;
  // M4.1: per-session idle timer state.
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleEmitted: boolean;
}

const newId = () => `sess-${randomUUID().slice(0, 8)}`;
const newEventId = () => `ev-${randomUUID().slice(0, 12)}`;

export function createSessionManager(opts: SessionManagerOptions): SessionManager {
  // M4.1: idle threshold (ms); 0 disables emission entirely (test path).
  // Non-numeric env values (e.g. CLAUDEVIS_IDLE_MS=off) fall back to the
  // 30000 default rather than producing a NaN that would fire the timer
  // immediately and emit a session.idle with durationMs: NaN.
  const IDLE_MS_RAW = Number(process.env.CLAUDEVIS_IDLE_MS ?? 30_000);
  const IDLE_MS = Number.isFinite(IDLE_MS_RAW) ? IDLE_MS_RAW : 30_000;

  const sessions = new Map<string, SessionState>();

  // requestId → sessionId lookup so permission.respond Commands can route to
  // the right subprocess. Populated by the emit hook below ONLY for non-
  // synthesized requestIds (synthesized "auto-deny-*" IDs from real-mode
  // parser have nothing to respond to — claude already denied at end of turn).
  // Cleaned up on session.kill / session.clear / session.ended.
  const pendingPermissions = new Map<string, string>();

  const cleanupPermissionsForSession = (sessionId: string) => {
    for (const [requestId, sid] of pendingPermissions) {
      if (sid === sessionId) pendingPermissions.delete(requestId);
    }
  };

  const armIdleTimer = (state: SessionState) => {
    if (IDLE_MS <= 0) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      if (!sessions.has(state.id)) return;
      if (state.idleEmitted) return;
      state.idleEmitted = true;
      emit({
        id: newEventId(),
        ts: Date.now(),
        sessionId: state.id,
        type: 'session.idle',
        durationMs: IDLE_MS,
      });
    }, IDLE_MS);
  };

  const resetIdle = (state: SessionState) => {
    state.idleEmitted = false;
    armIdleTimer(state);
  };

  const clearIdleTimer = (state: SessionState) => {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  };

  const emit = (e: Event) => {
    if (process.env.CLAUDEVIS_DEBUG === '1') {
      console.log(`[claudevis] emit type=${e.type} sessionId=${e.sessionId}`);
    }
    opts.store.append(e);
    // Track only non-synthesized permission requests. Real-mode auto-deny
    // synthesis (T2) emits requestIds with an "auto-deny-" prefix; those
    // have nothing to respond to and are skipped here.
    if (e.type === 'permission.requested' && !e.requestId.startsWith('auto-deny-')) {
      pendingPermissions.set(e.requestId, e.sessionId);
    } else if (e.type === 'permission.resolved') {
      pendingPermissions.delete(e.requestId);
    }
    opts.onEvent(e);
  };

  // Build the line handler outside the sub creation so it can be passed
  // EAGERLY into spawnSubprocess (see SubprocessOptions.onLine docstring).
  // This guarantees the very first line — typically `session.started` —
  // is never lost to a startup race.
  const makeFakeLineHandler = (state: SessionState) => (raw: unknown) => {
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
        // M4.1: fire deferred session.mode.changed (set in create() for fake
        // mode) immediately after session.started so frontend sees the
        // ordering invariant [started, mode.changed]. Cleared to null after
        // emission so a re-emitted session.started from the fixture (atypical)
        // does not re-fire the deferred mode.
        if (state.modeChangedDeferred !== null) {
          state.lastMode = state.modeChangedDeferred;
          emit({
            id: newEventId(),
            ts: Date.now(),
            sessionId: state.id,
            type: 'session.mode.changed',
            mode: state.modeChangedDeferred,
          });
          state.modeChangedDeferred = null;
        }
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
      case 'session.mode.changed': {
        // M4.1: fake fixture's /mode-test sentinel emits mid-session mode swaps.
        // Validate the mode is one of the known PermissionMode literals; default
        // 'auto' for unknown values (defensive — fixture should always send valid).
        const m =
          line.mode === 'auto' ||
          line.mode === 'plan' ||
          line.mode === 'autoAccept' ||
          line.mode === 'strict'
            ? line.mode
            : 'auto';
        state.lastMode = m;
        emit({
          ...base,
          type: 'session.mode.changed',
          mode: m,
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
      case 'system': {
        // M3b.2: fake fixture emits a system/init-shaped line at startup
        // carrying a hardcoded test catalog. Mirror the real-mode catalog
        // flow: build SkillEntry[], update knownInvokableNames, forward to
        // opts.onCatalog. Other system subtypes (hook_started, hook_response,
        // etc.) are silently accepted — informational, no Event emission.
        if (line.subtype === 'init') {
          const entries = buildSkillEntries({
            skills: Array.isArray(line.skills) ? line.skills : [],
            slash_commands: Array.isArray(line.slash_commands) ? line.slash_commands : [],
            agents: Array.isArray(line.agents) ? line.agents : [],
            plugins: Array.isArray(line.plugins)
              ? (line.plugins as Array<Record<string, unknown>>)
              : [],
          });
          state.knownInvokableNames = extractInvokableNames(entries);
          opts.onCatalog?.(entries);
        }
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
      clearIdleTimer(state);
      emit({
        id: newEventId(),
        ts: Date.now(),
        sessionId: state.id,
        type: 'session.ended',
        reason: code === 0 ? 'complete' : 'error',
        exitCode: code ?? undefined,
      });
      sessions.delete(state.id);
      // Cleanup dangling permission requests for this session.
      cleanupPermissionsForSession(state.id);
    });
  };

  return {
    create: async ({ cwd: rawCwd, name, model, resume, mode }) => {
      const cwd = expandTilde(rawCwd);
      const id = newId();
      const resolvedModel = model ?? 'sonnet';
      const resolvedMode: PermissionMode = mode ?? 'auto';
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
        knownInvokableNames: new Set<string>(),
        lastMode: resolvedMode,
        modeChangedDeferred: null,
        idleTimer: null,
        idleEmitted: false,
        // sub is filled in immediately below — declared here for type safety.
        // biome-ignore lint/suspicious/noExplicitAny: hole filled synchronously
        sub: undefined as any,
      };

      let lineHandler: (raw: unknown) => void;
      if (opts.mode === 'real') {
        const parserCtx: ParserContext = {
          sessionId: id,
          name: state.name,
          cwd,
          model: resolvedModel,
          repo: git.repo,
          branch: git.branch,
          newEventId,
          now: () => Date.now(),
          // Suppress parser-side session.started — emitted proactively below
          // so the UI shows the session as soon as the subprocess spawns,
          // without waiting for SessionStart hooks (which can take several
          // seconds before the delayed `system/init` line lands).
          emitSessionStartedFromInit: false,
          // M4.1: parser dedup against SessionManager's known mode. Note this
          // is a snapshot at construction time; if the user later issues
          // session.setMode (currently stubbed), the parser would not see the
          // update. Acceptable for M4.1 — setMode is out-of-scope.
          currentMode: state.lastMode,
          onCatalog: (raw) => {
            const entries = buildSkillEntries({
              skills: Array.isArray(raw.skills) ? raw.skills : [],
              slash_commands: Array.isArray(raw.slash_commands) ? raw.slash_commands : [],
              agents: Array.isArray(raw.agents) ? raw.agents : [],
              plugins: Array.isArray(raw.plugins)
                ? (raw.plugins as Array<Record<string, unknown>>)
                : [],
            });
            state.knownInvokableNames = extractInvokableNames(entries);
            opts.onCatalog?.(entries);
          },
        };
        const parse = createRealCliParser(parserCtx);
        lineHandler = (raw) => {
          if (process.env.CLAUDEVIS_DEBUG === '1') {
            const r = raw as { type?: string; subtype?: string };
            console.log(`[claudevis] line type=${r?.type} subtype=${r?.subtype ?? '-'} sess=${id}`);
          }
          resetIdle(state);
          const events = parse(raw);
          if (process.env.CLAUDEVIS_DEBUG === '1' && events.length === 0) {
            console.log('[claudevis]   -> dropped (parser returned 0 events)');
          }
          for (const ev of events) {
            // M4.1: keep state.lastMode in sync with parser-emitted mode
            // events so future parser reconstructions use the correct
            // dedup snapshot. Mirrors the fake handler's session.mode.changed
            // case + the deferred-emit path's lastMode update.
            if (ev.type === 'session.mode.changed') state.lastMode = ev.mode;
            emit(ev);
          }
        };
      } else {
        const fakeHandler = makeFakeLineHandler(state);
        lineHandler = (raw) => {
          resetIdle(state);
          fakeHandler(raw);
        };
      }

      const args = buildSpawnArgs({
        baseArgs: opts.claudeCommand.baseArgs,
        model: resolvedModel,
        resume,
      });
      console.log(
        `[claudevis] session.create id=${id} mode=${opts.mode} cwd=${cwd} cmd=${opts.claudeCommand.command} args=${JSON.stringify(args)}`,
      );
      try {
        state.sub = spawnSubprocess({
          command: opts.claudeCommand.command,
          args,
          cwd,
          onLine: lineHandler,
        });
        console.log(`[claudevis] session.create spawned pid=${state.sub.pid}`);
      } catch (err) {
        console.error(`[claudevis] session.create spawn FAILED: ${(err as Error).message}`);
        throw err;
      }
      sessions.set(id, state);
      wireExit(state);

      // Real-mode: claude doesn't emit `system/init` until SessionStart hooks
      // finish, which can take seconds. Emit session.started locally now so
      // the session card appears in the UI immediately. The parser is
      // configured with emitSessionStartedFromInit:false above, so when init
      // eventually arrives it is silently latched, not re-emitted. M4.1
      // additionally emits session.mode.changed{resolvedMode} in the same
      // sync code path so the frontend sees [started, mode.changed] adjacent.
      if (opts.mode === 'real') {
        emit({
          id: newEventId(),
          ts: Date.now(),
          sessionId: id,
          type: 'session.started',
          name: state.name,
          cwd,
          model: resolvedModel,
          repo: git.repo,
          branch: git.branch,
        });
        emit({
          id: newEventId(),
          ts: Date.now(),
          sessionId: id,
          type: 'session.mode.changed',
          mode: resolvedMode,
        });
        state.lastMode = resolvedMode;
      } else {
        // M4.1 (fake mode): the fixture emits session.started async via the
        // line handler. Defer the mode emission so the fake handler's
        // session.started case fires it RIGHT AFTER session.started — the
        // ordering invariant [started, mode.changed] holds in both modes.
        state.modeChangedDeferred = resolvedMode;
      }

      // M4.1: arm the idle timer; resets on every subsequent line received.
      armIdleTimer(state);

      return id;
    },
    send: async ({ sessionId, content }) => {
      const s = sessions.get(sessionId);
      if (!s) throw new Error(`no session ${sessionId}`);
      // M3b.2: when the prompt's first whitespace-delimited token after a
      // leading / matches a known catalog name, emit skill.invoked BEFORE
      // user.prompt so the chat narrative shows the invocation as a distinct
      // row. The catalog is populated from system/init; if it's empty (e.g.
      // session just started), no skill.invoked fires and the prompt passes
      // through normally.
      const trimmed = content.trimStart();
      if (trimmed.startsWith('/')) {
        const space = trimmed.indexOf(' ');
        const slashName = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
        const args = space === -1 ? undefined : trimmed.slice(space + 1);
        if (s.knownInvokableNames.has(slashName)) {
          emit({
            id: newEventId(),
            ts: Date.now(),
            sessionId,
            type: 'skill.invoked',
            skillName: slashName,
            args,
          });
        }
      }
      emit({
        id: newEventId(),
        ts: Date.now(),
        sessionId,
        type: 'user.prompt',
        content,
      });
      const payload =
        opts.mode === 'real'
          ? serializeUserPromptForRealCli(content)
          : { type: 'user.prompt', content };
      s.sub.write(payload);
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
      cleanupPermissionsForSession(sessionId);
      // M4.1: clear forces a fresh idle window after the /clear prompt is
      // processed. Re-arm via resetIdle so the next line received resets the
      // latch correctly.
      resetIdle(s);
      // For walking skeleton we model `/clear` as sending the literal text.
      // Real-claude integration in M2 will use the proper SDK semantics.
      s.sub.write({ type: 'user.prompt', content: '/clear' });
    },
    kill: async (sessionId) => {
      const s = sessions.get(sessionId);
      if (!s) return;
      clearIdleTimer(s);
      cleanupPermissionsForSession(sessionId);
      await s.sub.close();
    },
    respondToPermission: async ({ requestId, decision }) => {
      const sessionId = pendingPermissions.get(requestId);
      if (!sessionId) {
        throw new Error(`no pending permission for requestId ${requestId}`);
      }
      const s = sessions.get(sessionId);
      if (!s) {
        pendingPermissions.delete(requestId);
        throw new Error(`no session ${sessionId}`);
      }
      // Write a stream-json line to the subprocess stdin. The fake fixture (T7)
      // will read these and emit a matching permission.resolved Event. In real
      // mode this path is unreachable for synthesized auto-deny-* IDs (filtered
      // out by the emit hook above), so this is effectively fake-mode-only.
      s.sub.write({
        type: 'permission_response',
        request_id: requestId,
        decision,
      });
      pendingPermissions.delete(requestId);
    },
    list: () => Array.from(sessions.keys()),
    shutdown: async () => {
      for (const s of sessions.values()) clearIdleTimer(s);
      await Promise.all(Array.from(sessions.values()).map((s) => s.sub.close()));
      sessions.clear();
      pendingPermissions.clear();
    },
  };
}

// Permission modes — see spec §6.5
export type PermissionMode = 'auto' | 'plan' | 'autoAccept' | 'strict';

// Base fields on every event
export interface BaseEvent {
  id: string;
  ts: number;
  sessionId: string;
  parentEventId?: string;
}

export type Event = BaseEvent &
  (
    | {
        type: 'session.started';
        name: string;
        cwd: string;
        repo?: string;
        branch?: string;
        model: string;
      }
    | { type: 'session.ended'; reason: 'user' | 'error' | 'complete'; exitCode?: number }
    | { type: 'session.idle'; durationMs: number }
    | { type: 'session.mode.changed'; mode: PermissionMode }
    | { type: 'user.prompt'; content: string }
    | { type: 'agent.thinking'; content: string; streaming: boolean }
    | { type: 'agent.message'; content: string; streaming: boolean }
    | { type: 'tool.started'; callId: string; name: string; input: unknown }
    | {
        type: 'tool.completed';
        callId: string;
        output: unknown;
        status: 'ok' | 'error';
        durationMs: number;
      }
    | {
        type: 'subagent.dispatched';
        parentCallId: string;
        agentType: string;
        prompt: string;
        childSessionId: string;
      }
    | {
        type: 'subagent.completed';
        parentCallId: string;
        childSessionId: string;
        result: unknown;
        status: 'ok' | 'error';
      }
    | {
        type: 'tokens.updated';
        input: number;
        output: number;
        cached: number;
        costUsd: number;
        model: string;
      }
    | { type: 'file.changed'; path: string; plus: number; minus: number; preview?: string }
    | {
        type: 'permission.requested';
        requestId: string;
        toolName: string;
        toolInput: unknown;
        preview?: string;
        // Links this request to the originating tool.started.callId so the
        // UI can disambiguate when multiple tool calls are in flight.
        callId?: string;
      }
    | { type: 'permission.resolved'; requestId: string; decision: 'allow' | 'deny' | 'always' }
    | { type: 'skill.invoked'; skillName: string; args?: string }
    | { type: 'interrupt.signaled' }
    | { type: 'error'; message: string; recoverable: boolean }
  );

export type Command =
  | {
      type: 'session.create';
      cwd: string;
      name?: string;
      model?: string;
      mode?: PermissionMode;
      /**
       * M3b.3: when set, the server appends `--resume <id>` to the claude
       * spawn args, restoring the prior session's history.
       */
      resume?: string;
    }
  | { type: 'session.send'; sessionId: string; content: string }
  | { type: 'session.interrupt'; sessionId: string }
  | { type: 'session.clear'; sessionId: string }
  | { type: 'session.kill'; sessionId: string }
  | { type: 'session.setMode'; sessionId: string; mode: PermissionMode }
  | { type: 'permission.respond'; requestId: string; decision: 'allow' | 'deny' | 'always' }
  | { type: 'skill.list' }
  | { type: 'skill.run'; sessionId: string; skillName: string; args?: string }
  | { type: 'skill.install'; source: string }
  | { type: 'subscribe'; sessionIds: string[] | '*'; replay: boolean }
  | { type: 'settings.checkClaude' }
  | { type: 'settings.runLogin' };

// Server-to-client control frames (not in Event union — these are connection control)
export type ServerFrame =
  | { type: 'hello'; protocol: 'v1'; serverVersion: string }
  | { type: 'replay.done' }
  | { type: 'event'; event: Event }
  | { type: 'settings.status'; installed: boolean; loggedIn: boolean; version?: string }
  | { type: 'skill.catalog'; skills: SkillEntry[] }
  | { type: 'session.resumable'; sessions: ResumableSession[] };

export interface SkillEntry {
  name: string;
  description: string;
  source: 'user' | 'project' | 'plugin';
  path: string;
  // M3b.2: distinguishes invokable kinds for in-drawer category grouping.
  // Real CLI's system/init payload exposes skills, slash_commands, and agents
  // as three separate arrays of names; this field carries that distinction
  // through to the frontend. Optional to keep the change additive — clients
  // that don't set or read it see today's behavior.
  kind?: 'skill' | 'slash_command' | 'agent';
}

/**
 * M3b.3: metadata for a session the user previously ran in this cwd that
 * can be resumed via `claude --resume <id>`. Sourced from a filesystem scan
 * of `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` on subscribe; emitted
 * as a `session.resumable` ServerFrame to populate the frontend's "Resumable"
 * section of SessionList.
 */
export interface ResumableSession {
  id: string;
  cwd: string;
  name?: string;
  model?: string;
  lastActiveAt: number;
}

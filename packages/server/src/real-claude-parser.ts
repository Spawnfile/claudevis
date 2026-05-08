import type { Event, PermissionMode } from '@claudevis/shared';

function extractSubagentResult(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (
      first !== null &&
      typeof first === 'object' &&
      'type' in first &&
      (first as { type: unknown }).type === 'text' &&
      'text' in first &&
      typeof (first as { text: unknown }).text === 'string'
    ) {
      return (first as { text: string }).text;
    }
  }
  return content ?? null;
}

export interface ParserContext {
  sessionId: string;
  name: string;
  cwd: string;
  model: string;
  repo?: string;
  branch?: string;
  newEventId: () => string;
  now: () => number;
  /**
   * When true (default), the parser emits `session.started` the first time it
   * sees a `system/init` line. SessionManager passes `false` in real mode so
   * the session card appears in the UI as soon as the subprocess spawns,
   * without waiting for the SessionStart hooks (which take seconds) and the
   * delayed `system/init` line that follows them.
   */
  emitSessionStartedFromInit?: boolean;
  /**
   * Called with the raw system/init line body whenever the parser sees a
   * `{type:"system",subtype:"init"}` line. SessionManager uses this to
   * build the per-session SkillEntry[] and broadcast a skill.catalog
   * ServerFrame. Optional — when undefined, system/init still produces a
   * session.started Event the same way as M3a (subject to the
   * emitSessionStartedFromInit latch).
   */
  onCatalog?: (raw: Record<string, unknown>) => void;
  /**
   * M4.1: SessionManager-known current PermissionMode. The parser uses this
   * to dedup `system/init.permissionMode` reads — if upstream surfaces a
   * string field that matches the current mode, no event is emitted; if it
   * differs, the parser emits session.mode.changed. If the field is absent
   * or not a recognized PermissionMode literal, no event is emitted.
   */
  currentMode?: PermissionMode;
}

export type RealCliLineParser = (raw: unknown) => Event[];

export function createRealCliParser(ctx: ParserContext): RealCliLineParser {
  let sessionStartedEmitted = false;
  const toolStartTs = new Map<string, number>();
  const pendingFileEditCalls = new Map<string, { path: string }>();
  const taskCallIds = new Set<string>();

  const FILE_MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

  // M4.1: tracks the most recently emitted PermissionMode within this
  // parser's lifetime so duplicate system/init lines with the same
  // permissionMode value don't re-fire session.mode.changed. Initialized
  // from ctx.currentMode (SessionManager's known mode at parser construction).
  let lastEmittedMode: PermissionMode | undefined = ctx.currentMode;

  return (raw: unknown): Event[] => {
    if (raw === null || typeof raw !== 'object') return [];
    const line = raw as Record<string, unknown>;
    if (typeof line.type !== 'string') return [];

    if (line.type === 'system') {
      if (line.subtype === 'init') {
        const events: Event[] = [];
        // M4.1: opportunistic mode read. If upstream surfaces a recognized
        // permissionMode string AND it differs from lastEmittedMode (which
        // tracks the most recent emission within this parser closure), emit
        // session.mode.changed. Absence, unknown value, or duplicate value
        // is silently dropped.
        const VALID_MODES: ReadonlySet<string> = new Set(['auto', 'plan', 'autoAccept', 'strict']);
        if (
          typeof line.permissionMode === 'string' &&
          VALID_MODES.has(line.permissionMode) &&
          line.permissionMode !== lastEmittedMode
        ) {
          const mode = line.permissionMode as PermissionMode;
          lastEmittedMode = mode;
          events.push({
            id: ctx.newEventId(),
            ts: ctx.now(),
            sessionId: ctx.sessionId,
            type: 'session.mode.changed',
            mode,
          });
        }
        // M3b.2: hand the full init payload to SessionManager so it can build
        // and broadcast the skill catalog.
        if (ctx.onCatalog) ctx.onCatalog(line);
        if (sessionStartedEmitted) return events;
        sessionStartedEmitted = true;
        // When SessionManager emits session.started proactively (real-mode
        // default), the parser only acks the latch and stays silent.
        if (ctx.emitSessionStartedFromInit === false) return events;
        events.push({
          id: ctx.newEventId(),
          ts: ctx.now(),
          sessionId: ctx.sessionId,
          type: 'session.started',
          name: ctx.name,
          cwd: ctx.cwd,
          model: ctx.model,
          repo: ctx.repo,
          branch: ctx.branch,
        });
        return events;
      }
      return [];
    }

    if (line.type === 'assistant') {
      const message = line.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      const events: Event[] = [];
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === 'text' && typeof block.text === 'string') {
          events.push({
            id: ctx.newEventId(),
            ts: ctx.now(),
            sessionId: ctx.sessionId,
            type: 'agent.message',
            content: block.text,
            streaming: false,
          });
        }
        if (block.type === 'thinking' && typeof block.thinking === 'string') {
          events.push({
            id: ctx.newEventId(),
            ts: ctx.now(),
            sessionId: ctx.sessionId,
            type: 'agent.thinking',
            content: block.thinking,
            streaming: false,
          });
        }
        if (block.type === 'tool_use' && typeof block.id === 'string') {
          const toolName = typeof block.name === 'string' ? block.name : 'unknown';
          // REPLACE policy — Agent tool calls become subagent.* events. Plain
          // tool.started is suppressed to avoid double-emitting and to give
          // the future isometric scene grammar a clean signal. Note: the wire
          // format names this tool "Agent" — confirmed by M3a probe captures
          // (subagent-task.ndjson). Internally we still call the bookkeeping
          // set taskCallIds because the design doc and protocol union speak
          // of "Task tool" / "subagent dispatch" interchangeably.
          if (toolName === 'Agent') {
            const input = (block.input ?? {}) as Record<string, unknown>;
            taskCallIds.add(block.id);
            toolStartTs.set(block.id, ctx.now());
            events.push({
              id: ctx.newEventId(),
              ts: ctx.now(),
              sessionId: ctx.sessionId,
              type: 'subagent.dispatched',
              parentCallId: block.id,
              agentType: typeof input.subagent_type === 'string' ? input.subagent_type : 'unknown',
              prompt: typeof input.prompt === 'string' ? input.prompt : '',
              childSessionId: block.id,
            });
            continue;
          }
          // Track Edit-family calls so the matching tool_result can additionally
          // emit file.changed. Read the path from file_path or notebook_path;
          // if neither is present, skip tracking (file.changed won't fire).
          if (FILE_MUTATING_TOOLS.has(toolName)) {
            const input = (block.input ?? {}) as Record<string, unknown>;
            const path =
              typeof input.file_path === 'string'
                ? input.file_path
                : typeof input.notebook_path === 'string'
                  ? input.notebook_path
                  : null;
            if (path !== null) {
              pendingFileEditCalls.set(block.id, { path });
            }
          }
          toolStartTs.set(block.id, ctx.now());
          events.push({
            id: ctx.newEventId(),
            ts: ctx.now(),
            sessionId: ctx.sessionId,
            type: 'tool.started',
            callId: block.id,
            name: toolName,
            input: block.input ?? null,
          });
        }
      }
      return events;
    }

    if (line.type === 'user') {
      const message = line.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      const events: Event[] = [];
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const callId = block.tool_use_id;
          const startTs = toolStartTs.get(callId) ?? ctx.now();
          toolStartTs.delete(callId);
          const isError = block.is_error === true;
          // REPLACE policy for Agent tool — emit subagent.completed and skip
          // the plain tool.completed. The Agent tool_result content is a
          // structured array (item 0 = subagent text output, item 1 = agent
          // metadata). Extract item 0's text as the meaningful result; fall
          // back to verbatim content for unexpected shapes.
          if (taskCallIds.has(callId)) {
            taskCallIds.delete(callId);
            const result = extractSubagentResult(block.content);
            events.push({
              id: ctx.newEventId(),
              ts: ctx.now(),
              sessionId: ctx.sessionId,
              type: 'subagent.completed',
              parentCallId: callId,
              childSessionId: callId,
              result,
              status: isError ? 'error' : 'ok',
            });
            continue;
          }
          events.push({
            id: ctx.newEventId(),
            ts: ctx.now(),
            sessionId: ctx.sessionId,
            type: 'tool.completed',
            callId,
            output: block.content ?? null,
            status: isError ? 'error' : 'ok',
            durationMs: Math.max(0, ctx.now() - startTs),
          });
          // Additive file.changed for tracked Edit-family calls (success only).
          const tracked = pendingFileEditCalls.get(callId);
          if (tracked) {
            pendingFileEditCalls.delete(callId);
            if (!isError) {
              const previewSource =
                typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content ?? '');
              events.push({
                id: ctx.newEventId(),
                ts: ctx.now(),
                sessionId: ctx.sessionId,
                type: 'file.changed',
                path: tracked.path,
                plus: 0,
                minus: 0,
                preview: previewSource.slice(0, 200),
              });
            }
          }
        }
      }
      return events;
    }

    if (line.type === 'result') {
      const subtype = typeof line.subtype === 'string' ? line.subtype : 'success';
      const usage = (line.usage ?? {}) as Record<string, unknown>;
      const numOr = (v: unknown, fallback: number): number =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      const events: Event[] = [
        {
          id: ctx.newEventId(),
          ts: ctx.now(),
          sessionId: ctx.sessionId,
          type: 'tokens.updated',
          input: numOr(usage.input_tokens, 0),
          output: numOr(usage.output_tokens, 0),
          cached: numOr(usage.cache_read_input_tokens, 0),
          costUsd: numOr(line.total_cost_usd, 0),
          model: ctx.model,
        },
      ];
      if (subtype !== 'success') {
        events.push({
          id: ctx.newEventId(),
          ts: ctx.now(),
          sessionId: ctx.sessionId,
          type: 'error',
          message: typeof line.error === 'string' ? `${subtype}: ${line.error}` : subtype,
          recoverable: true,
        });
      }
      // Synthesize permission.requested + permission.resolved(deny) pairs from
      // permission_denials[]. Stream-json mode does not carry interactive
      // permission events; claude auto-denies and reports denials at end of
      // turn in this structured array. Each denial becomes one informational
      // request + immediate deny pair so the UI can surface "this tool failed
      // because of permissions" context. The synthesized requestId uses the
      // 'auto-deny-' prefix so the UI and SessionManager can distinguish
      // synthesized denials from interactive (fake-mode) requests.
      // "M3b.1 probe findings" for the wire shape.
      const denials = Array.isArray(line.permission_denials) ? line.permission_denials : [];
      for (const entry of denials) {
        if (entry === null || typeof entry !== 'object') continue;
        const denial = entry as Record<string, unknown>;
        const toolUseId = typeof denial.tool_use_id === 'string' ? denial.tool_use_id : null;
        if (toolUseId === null) continue;
        const toolName = typeof denial.tool_name === 'string' ? denial.tool_name : 'unknown';
        const toolInput = denial.tool_input ?? null;
        const requestId = `auto-deny-${toolUseId}`;
        events.push({
          id: ctx.newEventId(),
          ts: ctx.now(),
          sessionId: ctx.sessionId,
          type: 'permission.requested',
          requestId,
          toolName,
          toolInput,
          callId: toolUseId,
        });
        events.push({
          id: ctx.newEventId(),
          ts: ctx.now(),
          sessionId: ctx.sessionId,
          type: 'permission.resolved',
          requestId,
          decision: 'deny',
        });
      }
      return events;
    }

    if (line.type === 'error') {
      return [
        {
          id: ctx.newEventId(),
          ts: ctx.now(),
          sessionId: ctx.sessionId,
          type: 'error',
          message: typeof line.message === 'string' ? line.message : 'unknown error',
          recoverable: true,
        },
      ];
    }

    // Mappers added in subsequent tasks. Default: drop unknown lines.
    return [];
  };
}

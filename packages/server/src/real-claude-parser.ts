import type { Event } from '@claudevis/shared';

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
}

export type RealCliLineParser = (raw: unknown) => Event[];

export function createRealCliParser(ctx: ParserContext): RealCliLineParser {
  let sessionStartedEmitted = false;
  const toolStartTs = new Map<string, number>();
  const pendingFileEditCalls = new Map<string, { path: string }>();
  const taskCallIds = new Set<string>();

  const FILE_MUTATING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

  return (raw: unknown): Event[] => {
    if (raw === null || typeof raw !== 'object') return [];
    const line = raw as Record<string, unknown>;
    if (typeof line.type !== 'string') return [];

    if (line.type === 'system') {
      if (line.subtype === 'init' && !sessionStartedEmitted) {
        sessionStartedEmitted = true;
        // When SessionManager emits session.started proactively (real-mode
        // default), the parser only acks the latch and stays silent so the UI
        // doesn't see two session.started events for the same sessionId.
        if (ctx.emitSessionStartedFromInit === false) return [];
        return [
          {
            id: ctx.newEventId(),
            ts: ctx.now(),
            sessionId: ctx.sessionId,
            type: 'session.started',
            name: ctx.name,
            cwd: ctx.cwd,
            model: ctx.model,
            repo: ctx.repo,
            branch: ctx.branch,
          },
        ];
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

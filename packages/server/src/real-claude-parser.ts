import type { Event } from '@claudevis/shared';

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
          toolStartTs.set(block.id, ctx.now());
          events.push({
            id: ctx.newEventId(),
            ts: ctx.now(),
            sessionId: ctx.sessionId,
            type: 'tool.started',
            callId: block.id,
            name: typeof block.name === 'string' ? block.name : 'unknown',
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
          const startTs = toolStartTs.get(block.tool_use_id) ?? ctx.now();
          toolStartTs.delete(block.tool_use_id);
          events.push({
            id: ctx.newEventId(),
            ts: ctx.now(),
            sessionId: ctx.sessionId,
            type: 'tool.completed',
            callId: block.tool_use_id,
            output: block.content ?? null,
            status: block.is_error === true ? 'error' : 'ok',
            durationMs: Math.max(0, ctx.now() - startTs),
          });
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

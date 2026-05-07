// packages/web/src/scene/event-mapper.ts
// Pure function: Event → Mutation[]. Exhaustive over Event['type']; TypeScript
// proves coverage via the `_exhaustive: never` arm. Sub-milestones M3c.2b/M3c.3
// extend the mutation list per case; M3c.1 active cases are session.started/
// session.ended/tokens.updated/error. M3c.2a adds user.prompt / agent.thinking /
// agent.message / tool.started / tool.completed.

import type { Event } from '@claudevis/shared';
import type { Mutation } from './types';

const SPEECH_TRUNCATE = 40;

export function eventToMutations(e: Event): Mutation[] {
  switch (e.type) {
    case 'session.started':
      return [{ kind: 'spawnNpc', sessionId: e.sessionId, model: e.model, name: e.name }];
    case 'session.ended':
      return [{ kind: 'removeNpc', sessionId: e.sessionId }];
    // M3c.2a fills these:
    case 'user.prompt':
      return [
        {
          kind: 'glyph',
          sessionId: e.sessionId,
          sprite: 'glyphParchment',
          durationMs: 2000,
          content: e.content,
        },
      ];
    case 'agent.thinking':
      // Recency-based fade is owned by scene.ts; mutation passes content only.
      return [{ kind: 'thoughtCloud', sessionId: e.sessionId, content: e.content }];
    case 'agent.message':
      return [
        {
          kind: 'speechBubble',
          sessionId: e.sessionId,
          content: e.content.slice(0, SPEECH_TRUNCATE),
          durationMs: 3000,
        },
      ];
    case 'tool.started':
      return [{ kind: 'attachTool', sessionId: e.sessionId, callId: e.callId, name: e.name }];
    case 'tool.completed':
      return [{ kind: 'retractTool', sessionId: e.sessionId, callId: e.callId, status: e.status }];
    // M3c.1 already wired:
    case 'session.idle':
    case 'session.mode.changed':
      return [];
    case 'tokens.updated':
      return [
        { kind: 'updateStamina', sessionId: e.sessionId, costUsd: e.costUsd, model: e.model },
      ];
    case 'error':
      return [{ kind: 'errorFlash', message: e.message, sessionId: e.sessionId }];
    // M3c.2b fills these:
    case 'subagent.dispatched':
    case 'subagent.completed':
    case 'file.changed':
    case 'permission.requested':
    case 'permission.resolved':
    case 'skill.invoked':
      return [];
    // M3c.3 fills this:
    case 'interrupt.signaled':
      return [];
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return [];
    }
  }
}

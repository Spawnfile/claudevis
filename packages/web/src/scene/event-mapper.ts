// packages/web/src/scene/event-mapper.ts
// Pure function: Event → Mutation[]. Exhaustive over Event['type']; TypeScript
// proves coverage via the `_exhaustive: never` arm. M3c.1 active cases are
// session.started/session.ended/tokens.updated/error. M3c.2a added user.prompt /
// agent.thinking / agent.message / tool.started / tool.completed. M3c.2b adds
// the remaining 6: subagent.dispatched / subagent.completed / file.changed /
// permission.requested / permission.resolved / skill.invoked.
//
// Permission auto-deny synthesis (M3b.1): the server emits permission.requested
// with `requestId: 'auto-deny-<N>'` for events synthesized from the upstream
// CLI's `result.permission_denials[]` array — those are read-only sigils. Real
// interactive requests use the `req-fake-<N>` (or future real-mode) prefix.

import type { Event } from '@claudevis/shared';
import type { Mutation } from './types';

const SPEECH_TRUNCATE = 40;

export function eventToMutations(e: Event): Mutation[] {
  switch (e.type) {
    case 'session.started':
      return [{ kind: 'spawnNpc', sessionId: e.sessionId, model: e.model, name: e.name }];
    case 'session.ended':
      return [{ kind: 'removeNpc', sessionId: e.sessionId }];
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
    // M3c.2b fills these:
    case 'subagent.dispatched':
      // Two mutations per design §4.4.3: ring around parent + child NPC spawn.
      // The ring is keyed by parentCallId in scene.ts so the matching
      // subagent.completed (which carries the same parentCallId) can clean it up.
      return [
        { kind: 'summonRing', parentSessionId: e.sessionId, parentCallId: e.parentCallId },
        {
          kind: 'spawnSubagentNpc',
          childSessionId: e.childSessionId,
          parentSessionId: e.sessionId,
          agentType: e.agentType,
        },
      ];
    case 'subagent.completed':
      return [
        {
          kind: 'removeSubagentNpc',
          childSessionId: e.childSessionId,
          parentCallId: e.parentCallId,
        },
      ];
    case 'file.changed':
      // path-only mutation; M4 may add diff math (+/-) for richer rendering.
      return [{ kind: 'fileFly', sessionId: e.sessionId, path: e.path }];
    case 'permission.requested':
      return [
        {
          kind: 'permissionSigil',
          sessionId: e.sessionId,
          requestId: e.requestId,
          autoDeny: e.requestId.startsWith('auto-deny-'),
          toolName: e.toolName,
        },
      ];
    case 'permission.resolved':
      return [{ kind: 'dismissSigil', requestId: e.requestId, decision: e.decision }];
    case 'skill.invoked':
      return [{ kind: 'skillParchment', sessionId: e.sessionId, skillName: e.skillName }];
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

// packages/web/src/scene/event-mapper.ts
// Pure function: Event → Mutation[]. Exhaustive over Event['type']; TypeScript
// proves coverage via the `_exhaustive: never` arm. M4.1 closes the vocabulary
// matrix: session.mode.changed and session.idle now produce mutations. The
// session.started case carries an initial mode of 'auto' — session-manager
// emits session.mode.changed immediately after, so the value updates within
// microseconds when the user requested a non-default mode.
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
      return [
        {
          kind: 'spawnNpc',
          sessionId: e.sessionId,
          model: e.model,
          name: e.name,
          // Initial mode is 'auto'; session-manager emits session.mode.changed
          // immediately after session.started carrying the actual chosen mode,
          // so the icon updates within microseconds for non-default modes.
          mode: 'auto',
        },
      ];
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
    case 'subagent.dispatched':
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
      return [
        { kind: 'fileFly', sessionId: e.sessionId, path: e.path, plus: e.plus, minus: e.minus },
      ];
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
    // M4.1: vocabulary closure.
    case 'session.idle':
      return [{ kind: 'setIdle', sessionId: e.sessionId, idle: true }];
    case 'session.mode.changed':
      return [{ kind: 'swapModeIcon', sessionId: e.sessionId, mode: e.mode }];
    case 'tokens.updated':
      return [
        { kind: 'updateStamina', sessionId: e.sessionId, costUsd: e.costUsd, model: e.model },
      ];
    case 'error':
      return [
        {
          kind: 'errorFlash',
          message: e.message,
          sessionId: e.sessionId,
          recoverable: e.recoverable,
        },
      ];
    case 'interrupt.signaled':
      return [{ kind: 'shake', sessionId: e.sessionId }];
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return [];
    }
  }
}

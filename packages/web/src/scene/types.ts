// packages/web/src/scene/types.ts
// Mutation discriminated union — output of event-mapper, input of scene's apply step.
// M3c.1 covered spawnNpc / removeNpc / updateStamina / errorFlash.
// M3c.2a added glyph / thoughtCloud / speechBubble / attachTool / retractTool.
// M3c.2b added summonRing / spawnSubagentNpc / removeSubagentNpc / fileFly /
//   permissionSigil / dismissSigil / skillParchment.
// M3c.3 added shake (interrupt.signaled) and extended errorFlash with `recoverable`.
// M4.1 adds swapModeIcon (session.mode.changed) and setIdle (session.idle), and
// extends spawnNpc with `mode` so the initial mode-icon sprite attaches at NPC
// spawn time without a flash-of-wrong-icon when session.mode.changed lands.

import type { PermissionMode } from '@claudevis/shared';

export type Mutation =
  | { kind: 'spawnNpc'; sessionId: string; model: string; name: string; mode: PermissionMode }
  | { kind: 'removeNpc'; sessionId: string }
  | { kind: 'updateStamina'; sessionId: string; costUsd: number; model: string }
  | { kind: 'errorFlash'; message: string; sessionId?: string; recoverable: boolean }
  | {
      kind: 'glyph';
      sessionId: string;
      sprite: 'glyphParchment';
      durationMs: number;
      content?: string;
    }
  | { kind: 'thoughtCloud'; sessionId: string; content: string }
  | { kind: 'speechBubble'; sessionId: string; content: string; durationMs: number }
  | { kind: 'attachTool'; sessionId: string; callId: string; name: string }
  | { kind: 'retractTool'; sessionId: string; callId: string; status: 'ok' | 'error' }
  | { kind: 'summonRing'; parentSessionId: string; parentCallId: string }
  | {
      kind: 'spawnSubagentNpc';
      childSessionId: string;
      parentSessionId: string;
      agentType: string;
    }
  | { kind: 'removeSubagentNpc'; childSessionId: string; parentCallId: string }
  | { kind: 'fileFly'; sessionId: string; path: string }
  | {
      kind: 'permissionSigil';
      sessionId: string;
      requestId: string;
      autoDeny: boolean;
      toolName: string;
    }
  | { kind: 'dismissSigil'; requestId: string; decision: 'allow' | 'always' | 'deny' }
  | { kind: 'skillParchment'; sessionId: string; skillName: string }
  | { kind: 'shake'; sessionId: string }
  | { kind: 'swapModeIcon'; sessionId: string; mode: PermissionMode }
  | { kind: 'setIdle'; sessionId: string; idle: boolean };

// Scene's internal index — what the event-mapper can read about current state.
// M3c.1 only needs npcs; M3c.2a/b extend if event-mapper needs scene state lookups.
export interface SceneIndex {
  npcs: Map<string, NpcSnapshot>;
}

export interface NpcSnapshot {
  sessionId: string;
  model: string;
  name: string;
  costUsd: number;
  state: 'idle' | 'working' | 'errored';
  // M4.1: mode is the current PermissionMode; the dom-mirror surfaces it as
  // data-scene-npc-mode for e2e. `idle` is the M4.1 idle latch — true between
  // session.idle and the next non-idle mutation; surfaces as data-scene-npc-idle.
  mode: PermissionMode;
  idle: boolean;
}

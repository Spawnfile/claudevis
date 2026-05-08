// packages/web/src/scene/types.ts
// Mutation discriminated union — output of event-mapper, input of scene's apply step.
// M3c.1 covered spawnNpc / removeNpc / updateStamina / errorFlash.
// M3c.2a added glyph / thoughtCloud / speechBubble / attachTool / retractTool.
// M3c.2b adds summonRing / spawnSubagentNpc / removeSubagentNpc / fileFly /
//   permissionSigil / dismissSigil / skillParchment.
// M3c.3 adds shake (interrupt.signaled) and extends errorFlash with `recoverable`
// so the scene handler can choose between NPC-localized flash (recoverable=true)
// and scene-wide ember flash (recoverable=false) per design §4.5.

export type Mutation =
  | { kind: 'spawnNpc'; sessionId: string; model: string; name: string }
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
  | { kind: 'shake'; sessionId: string };

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
}

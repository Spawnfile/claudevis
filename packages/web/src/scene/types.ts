// packages/web/src/scene/types.ts
// Mutation discriminated union — output of event-mapper, input of scene's apply step.
// M3c.1 covered spawnNpc / removeNpc / updateStamina / errorFlash.
// M3c.2a adds glyph / thoughtCloud / speechBubble / attachTool / retractTool.
// M3c.2b/3 extend further (subagent ring, fileFly, permission sigil, skill parchment, shake).

export type Mutation =
  | { kind: 'spawnNpc'; sessionId: string; model: string; name: string }
  | { kind: 'removeNpc'; sessionId: string }
  | { kind: 'updateStamina'; sessionId: string; costUsd: number; model: string }
  | { kind: 'errorFlash'; message: string; sessionId?: string }
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
  | { kind: 'retractTool'; sessionId: string; callId: string; status: 'ok' | 'error' };

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

// packages/web/src/scene/types.ts
// Mutation discriminated union — output of event-mapper, input of scene's apply step.
// M3c.1 covers spawnNpc / removeNpc / updateStamina / errorFlash. Other variants
// are placeholders that resolve to no-op in M3c.1 (event-mapper returns []).
// M3c.2a/b extend this union as new mutations are wired.

export type Mutation =
  | { kind: 'spawnNpc'; sessionId: string; model: string; name: string }
  | { kind: 'removeNpc'; sessionId: string }
  | { kind: 'updateStamina'; sessionId: string; costUsd: number; model: string }
  | { kind: 'errorFlash'; message: string; sessionId?: string };

// Scene's internal index — what the event-mapper can read about current state.
// M3c.1 only needs npcs; M3c.2a/b extend.
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

// packages/web/src/scene/dom-mirror.ts
// E2E hook: mirrors PixiJS scene state into invisible DOM nodes that Playwright
// can query. Each call replaces the entire mirror — scene state changes go
// through one full re-render of the mirror, which is fine at our event rate.

let mirrorEl: HTMLDivElement | null = null;

function ensureEl(): HTMLDivElement {
  if (mirrorEl?.isConnected) return mirrorEl;
  mirrorEl = document.createElement('div');
  mirrorEl.id = 'scene-dom-mirror';
  mirrorEl.style.display = 'none';
  document.body.appendChild(mirrorEl);
  return mirrorEl;
}

export interface MirrorInput {
  npcs: Map<
    string,
    { sessionId: string; model: string; name: string; costUsd: number; state: string }
  >;
  subagentNpcs: Map<
    string,
    {
      childSessionId?: string;
      parentSessionId: string;
      agentType?: string;
      deepDispatch?: boolean;
    }
  >;
  sigils: Map<string, { autoDeny?: boolean; requestId: string; toolName?: string }>;
  glyphs: Map<string, { kind: string; sessionId: string; content?: string }>;
  toolIcons: Map<string, { name: string; sessionId: string }>;
  archive?: { count: number };
  /**
   * Cumulative count of subagent NPCs that have been spawned in this scene's
   * lifetime. Increments on every spawnSubagentNpc and NEVER decrements. The
   * timing-robust e2e signal: even if the dispatched/completed events arrive
   * close enough together that the in-flight subagent is never visible in the
   * mirror, the spawn-count survives and e2e can assert it incremented.
   */
  subagentSpawnCount?: number;
}

export function mirrorState(s: MirrorInput): void {
  const el = ensureEl();
  el.innerHTML = '';

  for (const [id, npc] of s.npcs) {
    const d = document.createElement('div');
    d.setAttribute('data-scene-npc-id', id);
    d.setAttribute('data-scene-npc-state', npc.state ?? 'idle');
    d.setAttribute('data-scene-npc-model', npc.model ?? '');
    d.setAttribute('data-scene-npc-cost', String(npc.costUsd ?? 0));
    el.appendChild(d);
  }

  for (const [id, child] of s.subagentNpcs) {
    const d = document.createElement('div');
    d.setAttribute('data-scene-subagent-id', id);
    d.setAttribute('data-scene-subagent-parent', child.parentSessionId);
    if (child.agentType) d.setAttribute('data-scene-subagent-agent-type', child.agentType);
    if (child.deepDispatch) d.setAttribute('data-scene-subagent-deep', 'true');
    el.appendChild(d);
  }

  for (const [reqId, sigil] of s.sigils) {
    const d = document.createElement('div');
    d.setAttribute('data-scene-sigil-request-id', reqId);
    d.setAttribute('data-scene-sigil-mode', sigil.autoDeny ? 'auto-deny' : 'interactive');
    if (sigil.toolName) d.setAttribute('data-scene-sigil-tool-name', sigil.toolName);
    el.appendChild(d);
  }

  for (const [glyphId, g] of s.glyphs) {
    const d = document.createElement('div');
    d.setAttribute('data-scene-glyph-id', glyphId);
    d.setAttribute('data-scene-glyph-kind', g.kind);
    d.setAttribute('data-scene-glyph-session', g.sessionId);
    if (g.content !== undefined) d.setAttribute('data-scene-glyph-content', g.content);
    el.appendChild(d);
  }

  for (const [callId, tool] of s.toolIcons) {
    const d = document.createElement('div');
    d.setAttribute('data-scene-tool-call-id', callId);
    d.setAttribute('data-scene-tool-name', tool.name);
    d.setAttribute('data-scene-tool-session', tool.sessionId);
    el.appendChild(d);
  }

  if (s.archive && s.archive.count > 0) {
    const d = document.createElement('div');
    d.setAttribute('data-scene-archive-count', String(s.archive.count));
    el.appendChild(d);
  }

  if (s.subagentSpawnCount !== undefined && s.subagentSpawnCount > 0) {
    const d = document.createElement('div');
    d.setAttribute('data-scene-subagent-spawn-count', String(s.subagentSpawnCount));
    el.appendChild(d);
  }
}

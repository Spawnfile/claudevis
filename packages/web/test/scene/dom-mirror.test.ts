// packages/web/test/scene/dom-mirror.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { type MirrorInput, mirrorState } from '../../src/scene/dom-mirror';

type NpcEntry = MirrorInput['npcs'] extends Map<string, infer V> ? V : never;
type GlyphEntry = MirrorInput['glyphs'] extends Map<string, infer V> ? V : never;

describe('dom-mirror.mirrorState', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates the mirror element on first call', () => {
    mirrorState({
      npcs: new Map(),
      subagentNpcs: new Map(),
      sigils: new Map(),
      glyphs: new Map(),
      toolIcons: new Map(),
    });
    expect(document.getElementById('scene-dom-mirror')).not.toBeNull();
  });

  it('mirror element is invisible (display: none)', () => {
    mirrorState({
      npcs: new Map(),
      subagentNpcs: new Map(),
      sigils: new Map(),
      glyphs: new Map(),
      toolIcons: new Map(),
    });
    const el = document.getElementById('scene-dom-mirror') as HTMLElement;
    expect(el.style.display).toBe('none');
  });

  it('writes one div per NPC with data-scene-npc-id', () => {
    const npcs = new Map<string, NpcEntry>([
      [
        'session-1',
        { sessionId: 'session-1', model: 'sonnet', name: 's1', costUsd: 0, state: 'idle' },
      ],
      [
        'session-2',
        { sessionId: 'session-2', model: 'opus', name: 's2', costUsd: 0.05, state: 'working' },
      ],
    ]);
    mirrorState({
      npcs,
      subagentNpcs: new Map(),
      sigils: new Map(),
      glyphs: new Map(),
      toolIcons: new Map(),
    });
    const els = document.querySelectorAll('[data-scene-npc-id]');
    expect(els).toHaveLength(2);
    expect(els[0]!.getAttribute('data-scene-npc-id')).toBe('session-1');
    expect(els[0]!.getAttribute('data-scene-npc-state')).toBe('idle');
    expect(els[0]!.getAttribute('data-scene-npc-model')).toBe('sonnet');
    expect(els[1]!.getAttribute('data-scene-npc-state')).toBe('working');
  });

  it('replaces previous mirror state on each call (no stale entries)', () => {
    mirrorState({
      npcs: new Map([
        ['a', { sessionId: 'a', model: 'sonnet', name: '', costUsd: 0, state: 'idle' }],
      ]),
      subagentNpcs: new Map(),
      sigils: new Map(),
      glyphs: new Map(),
      toolIcons: new Map(),
    });
    expect(document.querySelectorAll('[data-scene-npc-id]')).toHaveLength(1);
    mirrorState({
      npcs: new Map(),
      subagentNpcs: new Map(),
      sigils: new Map(),
      glyphs: new Map(),
      toolIcons: new Map(),
    });
    expect(document.querySelectorAll('[data-scene-npc-id]')).toHaveLength(0);
  });

  it('writes data-scene-glyph-id and kind for transient glyphs', () => {
    const glyphs = new Map<string, GlyphEntry>([
      ['g1', { kind: 'parchment', sessionId: 'session-1' }],
    ]);
    mirrorState({
      npcs: new Map(),
      subagentNpcs: new Map(),
      sigils: new Map(),
      glyphs,
      toolIcons: new Map(),
    });
    const el = document.querySelector('[data-scene-glyph-id="g1"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-scene-glyph-kind')).toBe('parchment');
    expect(el?.getAttribute('data-scene-glyph-session')).toBe('session-1');
  });
});

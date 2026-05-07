// packages/web/test/scene/dom-mirror.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { type MirrorInput, mirrorState } from '../../src/scene/dom-mirror';

type NpcEntry = MirrorInput['npcs'] extends Map<string, infer V> ? V : never;
type GlyphEntry = MirrorInput['glyphs'] extends Map<string, infer V> ? V : never;
type ToolEntry = MirrorInput['toolIcons'] extends Map<string, infer V> ? V : never;

const emptyInput = (): MirrorInput => ({
  npcs: new Map(),
  subagentNpcs: new Map(),
  sigils: new Map(),
  glyphs: new Map(),
  toolIcons: new Map(),
});

describe('dom-mirror.mirrorState', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates the mirror element on first call', () => {
    mirrorState(emptyInput());
    expect(document.getElementById('scene-dom-mirror')).not.toBeNull();
  });

  it('mirror element is invisible (display: none)', () => {
    mirrorState(emptyInput());
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
    mirrorState({ ...emptyInput(), npcs });
    const els = document.querySelectorAll('[data-scene-npc-id]');
    expect(els).toHaveLength(2);
    expect(els[0]!.getAttribute('data-scene-npc-id')).toBe('session-1');
    expect(els[0]!.getAttribute('data-scene-npc-state')).toBe('idle');
    expect(els[0]!.getAttribute('data-scene-npc-model')).toBe('sonnet');
    expect(els[1]!.getAttribute('data-scene-npc-state')).toBe('working');
  });

  it('replaces previous mirror state on each call (no stale entries)', () => {
    mirrorState({
      ...emptyInput(),
      npcs: new Map([
        ['a', { sessionId: 'a', model: 'sonnet', name: '', costUsd: 0, state: 'idle' }],
      ]),
    });
    expect(document.querySelectorAll('[data-scene-npc-id]')).toHaveLength(1);
    mirrorState(emptyInput());
    expect(document.querySelectorAll('[data-scene-npc-id]')).toHaveLength(0);
  });

  it('writes data-scene-glyph-id and kind for transient glyphs', () => {
    const glyphs = new Map<string, GlyphEntry>([
      ['g1', { kind: 'parchment', sessionId: 'session-1' }],
    ]);
    mirrorState({ ...emptyInput(), glyphs });
    const el = document.querySelector('[data-scene-glyph-id="g1"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-scene-glyph-kind')).toBe('parchment');
    expect(el?.getAttribute('data-scene-glyph-session')).toBe('session-1');
    expect(el?.getAttribute('data-scene-glyph-content')).toBeNull();
  });

  it('writes data-scene-glyph-content when content is provided', () => {
    const glyphs = new Map<string, GlyphEntry>([
      ['g2', { kind: 'speech', sessionId: 'session-2', content: 'hello world' }],
    ]);
    mirrorState({ ...emptyInput(), glyphs });
    const el = document.querySelector('[data-scene-glyph-id="g2"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-scene-glyph-kind')).toBe('speech');
    expect(el?.getAttribute('data-scene-glyph-content')).toBe('hello world');
  });

  it('writes data-scene-tool-call-id and tool name for attached tools', () => {
    const toolIcons = new Map<string, ToolEntry>([
      ['call-1', { name: 'Bash', sessionId: 'session-1' }],
      ['call-2', { name: 'Read', sessionId: 'session-1' }],
    ]);
    mirrorState({ ...emptyInput(), toolIcons });
    const els = document.querySelectorAll('[data-scene-tool-call-id]');
    expect(els).toHaveLength(2);
    expect(els[0]!.getAttribute('data-scene-tool-call-id')).toBe('call-1');
    expect(els[0]!.getAttribute('data-scene-tool-name')).toBe('Bash');
    expect(els[0]!.getAttribute('data-scene-tool-session')).toBe('session-1');
    expect(els[1]!.getAttribute('data-scene-tool-call-id')).toBe('call-2');
    expect(els[1]!.getAttribute('data-scene-tool-name')).toBe('Read');
  });
});

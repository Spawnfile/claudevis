// packages/web/test/scene/dom-mirror.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { type MirrorInput, mirrorState } from '../../src/scene/dom-mirror';

type NpcEntry = MirrorInput['npcs'] extends Map<string, infer V> ? V : never;
type GlyphEntry = MirrorInput['glyphs'] extends Map<string, infer V> ? V : never;
type ToolEntry = MirrorInput['toolIcons'] extends Map<string, infer V> ? V : never;
type SubagentEntry = MirrorInput['subagentNpcs'] extends Map<string, infer V> ? V : never;
type SigilEntry = MirrorInput['sigils'] extends Map<string, infer V> ? V : never;

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

  // M3c.2b additions.

  it('writes data-scene-subagent-id, parent, and agent-type for child NPCs', () => {
    const subagentNpcs = new Map<string, SubagentEntry>([
      ['child-1', { parentSessionId: 'session-1', agentType: 'planner' }],
    ]);
    mirrorState({ ...emptyInput(), subagentNpcs });
    const el = document.querySelector('[data-scene-subagent-id="child-1"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-scene-subagent-parent')).toBe('session-1');
    expect(el?.getAttribute('data-scene-subagent-agent-type')).toBe('planner');
    expect(el?.getAttribute('data-scene-subagent-deep')).toBeNull();
  });

  it('writes data-scene-subagent-deep="true" when the entry is a deep-dispatch placeholder', () => {
    const subagentNpcs = new Map<string, SubagentEntry>([
      ['deep-1', { parentSessionId: 'session-1', deepDispatch: true }],
    ]);
    mirrorState({ ...emptyInput(), subagentNpcs });
    const el = document.querySelector('[data-scene-subagent-id="deep-1"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-scene-subagent-deep')).toBe('true');
  });

  it('writes data-scene-sigil-mode and tool-name for permission sigils', () => {
    const sigils = new Map<string, SigilEntry>([
      ['req-fake-1', { requestId: 'req-fake-1', autoDeny: false, toolName: 'Bash' }],
      ['auto-deny-7', { requestId: 'auto-deny-7', autoDeny: true, toolName: 'Write' }],
    ]);
    mirrorState({ ...emptyInput(), sigils });
    const interactive = document.querySelector('[data-scene-sigil-request-id="req-fake-1"]');
    expect(interactive).not.toBeNull();
    expect(interactive?.getAttribute('data-scene-sigil-mode')).toBe('interactive');
    expect(interactive?.getAttribute('data-scene-sigil-tool-name')).toBe('Bash');
    const auto = document.querySelector('[data-scene-sigil-request-id="auto-deny-7"]');
    expect(auto).not.toBeNull();
    expect(auto?.getAttribute('data-scene-sigil-mode')).toBe('auto-deny');
    expect(auto?.getAttribute('data-scene-sigil-tool-name')).toBe('Write');
  });

  it('writes data-scene-archive-count when archive is provided', () => {
    mirrorState({ ...emptyInput(), archive: { count: 3 } });
    const el = document.querySelector('[data-scene-archive-count]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-scene-archive-count')).toBe('3');
  });

  it('omits archive entry entirely when count is 0', () => {
    mirrorState({ ...emptyInput(), archive: { count: 0 } });
    const el = document.querySelector('[data-scene-archive-count]');
    expect(el).toBeNull();
  });

  it('writes data-scene-subagent-spawn-count when provided and > 0', () => {
    mirrorState({ ...emptyInput(), subagentSpawnCount: 2 });
    const el = document.querySelector('[data-scene-subagent-spawn-count]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-scene-subagent-spawn-count')).toBe('2');
  });

  it('omits subagent-spawn-count entry when 0 or undefined', () => {
    mirrorState({ ...emptyInput(), subagentSpawnCount: 0 });
    expect(document.querySelector('[data-scene-subagent-spawn-count]')).toBeNull();
    mirrorState(emptyInput());
    expect(document.querySelector('[data-scene-subagent-spawn-count]')).toBeNull();
  });
});

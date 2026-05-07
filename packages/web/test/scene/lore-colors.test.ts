// packages/web/test/scene/lore-colors.test.ts
import { describe, expect, it } from 'vitest';
import {
  AGENT_COLORS,
  MODEL_COLORS,
  MODE_COLORS,
  STAMINA_GLYPH,
  TOOL_COLORS,
} from '../../src/scene/lore-colors';

describe('lore-colors', () => {
  it('MODEL_COLORS contains exact lore-locked values per lore.md', () => {
    expect(MODEL_COLORS.haiku).toBe(0x7090a8);
    expect(MODEL_COLORS.sonnet).toBe(0xc2693f);
    expect(MODEL_COLORS.opus).toBe(0xc9a96e);
  });

  it('MODE_COLORS contains all four modes', () => {
    expect(MODE_COLORS.auto).toBe(0x8b1f1a);
    expect(MODE_COLORS.plan).toBe(0x5a4f8a);
    expect(MODE_COLORS.autoAccept).toBe(0x7d8c3d);
    expect(MODE_COLORS.strict).toBe(0x3a4d6a);
  });

  it('TOOL_COLORS contains the six lore-mapped tools', () => {
    expect(TOOL_COLORS.Bash).toBe(0x3a3a40);
    expect(TOOL_COLORS.Read).toBe(0xc9a96e);
    expect(TOOL_COLORS.Edit).toBe(0x7090a8);
    expect(TOOL_COLORS.Write).toBe(0x1a1410);
    expect(TOOL_COLORS.Grep).toBe(0x7a5a44);
    expect(TOOL_COLORS.Task).toBe(0xe8a541);
  });

  it('AGENT_COLORS contains the six lore-mapped agents', () => {
    expect(AGENT_COLORS.planner).toBe(0x2d5a8b);
    expect(AGENT_COLORS['code-reviewer']).toBe(0x3a3a4a);
    expect(AGENT_COLORS['security-reviewer']).toBe(0x2d4a6b);
    expect(AGENT_COLORS['build-error-resolver']).toBe(0x7a4f25);
    expect(AGENT_COLORS['tdd-guide']).toBe(0xa89878);
    expect(AGENT_COLORS.researcher).toBe(0x3d6b3d);
  });

  it('STAMINA_GLYPH maps each model to the correct sprite key', () => {
    expect(STAMINA_GLYPH.haiku).toBe('glyphStaminaBread');
    expect(STAMINA_GLYPH.sonnet).toBe('glyphStaminaCoin');
    expect(STAMINA_GLYPH.opus).toBe('glyphStaminaGold');
  });
});

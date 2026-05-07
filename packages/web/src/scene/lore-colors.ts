// packages/web/src/scene/lore-colors.ts
// Source: packages/landing/lore/lore.md ("Bestiarium claudevisi"). When a color
// changes here, update lore.md in the same PR (and vice versa). The two are the
// joint source of truth: lore.md = narrative; this file = code.

export const MODEL_COLORS = {
  haiku: 0x7090a8, // Light-Footed (bread)
  sonnet: 0xc2693f, // Steady Hand (coin)
  opus: 0xc9a96e, // The Elder (gold)
} as const;

export const MODE_COLORS = {
  auto: 0x8b1f1a, // Headstrong
  plan: 0x5a4f8a, // Cartographer
  autoAccept: 0x7d8c3d, // Trusting
  strict: 0x3a4d6a, // Wary
} as const;

export const TOOL_COLORS = {
  Bash: 0x3a3a40, // Forge
  Read: 0xc9a96e, // Cartographer's Eye
  Edit: 0x7090a8, // Chisel
  Write: 0x1a1410, // Quill
  Grep: 0x7a5a44, // Hound
  Task: 0xe8a541, // Summon (matches --torch)
} as const;

export const AGENT_COLORS = {
  planner: 0x2d5a8b, // Architect
  'code-reviewer': 0x3a3a4a, // Reeve
  'security-reviewer': 0x2d4a6b, // Sheriff
  'build-error-resolver': 0x7a4f25, // Smithy's Aide
  'tdd-guide': 0xa89878, // Apprentice Proper
  researcher: 0x3d6b3d, // Wanderer
} as const;

// Stamina visual: bread for Haiku, coin for Sonnet, gold for Opus.
// Each "segment" of the bar represents a doubling of cumulative cost.
// Bar full at $1.60+ (5 segments). See stamina.ts for thresholds.
export const STAMINA_GLYPH = {
  haiku: 'glyphStaminaBread',
  sonnet: 'glyphStaminaCoin',
  opus: 'glyphStaminaGold',
} as const;

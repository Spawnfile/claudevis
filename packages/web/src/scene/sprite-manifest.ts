// M3c.1 + M3c.2a + M3c.2b sprites. Paths are web-root-absolute; Vite serves
// `packages/web/public/` at /.

export const SPRITES = {
  npc: '/sprites/npc.svg',
  tileGrass: '/sprites/tile-grass.svg',
  cottageSmall: '/sprites/cottage-small.svg',
  lanternPost: '/sprites/lantern-post.svg',
  well: '/sprites/well.svg',
  glyphStaminaBread: '/sprites/glyph-stamina-bread.svg',
  glyphStaminaCoin: '/sprites/glyph-stamina-coin.svg',
  glyphStaminaGold: '/sprites/glyph-stamina-gold.svg',
  // M3c.2a additions
  glyphParchment: '/sprites/glyph-parchment.svg',
  glyphThought: '/sprites/glyph-thought.svg',
  glyphSpeech: '/sprites/glyph-speech.svg',
  toolGeneric: '/sprites/tool-generic.svg',
  // M3c.2b additions — 5 lore-locked tools
  toolForge: '/sprites/tool-forge.svg',
  toolLens: '/sprites/tool-lens.svg',
  toolChisel: '/sprites/tool-chisel.svg',
  toolQuill: '/sprites/tool-quill.svg',
  toolHound: '/sprites/tool-hound.svg',
  // M3c.2b — 4 mode icons (added but not yet instantiated; M4 wires session.mode.changed)
  modeHeadstrong: '/sprites/mode-headstrong.svg',
  modeCartographer: '/sprites/mode-cartographer.svg',
  modeTrusting: '/sprites/mode-trusting.svg',
  modeWary: '/sprites/mode-wary.svg',
  // M3c.2b — 6 agent badges
  badgeArchitect: '/sprites/badge-architect.svg',
  badgeReeve: '/sprites/badge-reeve.svg',
  badgeSheriff: '/sprites/badge-sheriff.svg',
  badgeSmithy: '/sprites/badge-smithy.svg',
  badgeApprentice: '/sprites/badge-apprentice.svg',
  badgeWanderer: '/sprites/badge-wanderer.svg',
  // M3c.2b — 2 sigils + 1 ring
  sigilPermission: '/sprites/sigil-permission.svg',
  sigilError: '/sprites/sigil-error.svg',
  summonRing: '/sprites/summon-ring.svg',
} as const;

export type SpriteName = keyof typeof SPRITES;

// Tool-name → manifest-key lookup. tool.started carries the wire-side tool name
// ("Bash", "Read", etc.); the scene resolves it to a sprite key. Unmapped names
// fall back to `toolGeneric` (the M3c.2a placeholder) — covers MultiEdit,
// NotebookEdit, custom tools, and anything the upstream CLI adds in future.
export const TOOL_SPRITE_KEY: Readonly<Record<string, SpriteName>> = {
  Bash: 'toolForge',
  Read: 'toolLens',
  Edit: 'toolChisel',
  Write: 'toolQuill',
  Grep: 'toolHound',
  // Task is rendered as a summon ring (not an icon attached to NPC), so it is
  // intentionally NOT in this lookup — tool.started for Task still falls
  // through to toolGeneric here, while subagent.dispatched paints the ring.
};

// Agent-type → badge sprite-key lookup. subagent.dispatched carries the
// agentType string (e.g. "planner", "code-reviewer", or harness-specific
// values like "Explore", "general-purpose"). Unmapped types fall back to
// `badgeWanderer` — the lore-canon Wanderer is the explorer/fallback.
export const AGENT_SPRITE_KEY: Readonly<Record<string, SpriteName>> = {
  planner: 'badgeArchitect',
  'code-reviewer': 'badgeReeve',
  'security-reviewer': 'badgeSheriff',
  'build-error-resolver': 'badgeSmithy',
  'tdd-guide': 'badgeApprentice',
  researcher: 'badgeWanderer',
};

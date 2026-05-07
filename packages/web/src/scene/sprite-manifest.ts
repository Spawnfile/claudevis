// M3c.1 + M3c.2a subset of sprites. M3c.2b extends with lore-locked tool/mode/agent icons.
// Paths are web-root-absolute; Vite serves `packages/web/public/` at /.

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
} as const;

export type SpriteName = keyof typeof SPRITES;

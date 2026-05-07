// M3c.1 subset of sprites. M3c.2a/b extend with tool/mode/agent/glyph icons.
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
} as const;

export type SpriteName = keyof typeof SPRITES;

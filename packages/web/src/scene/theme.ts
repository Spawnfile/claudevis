// packages/web/src/scene/theme.ts
// TS-side theme constants. Mirrors the CSS variables defined in styles.css :root.
// These constants are consumed by PixiJS scene code where CSS vars cannot reach.

export const TILE = {
  w: 64, // logical pixel width of an iso diamond tile
  h: 32, // logical pixel height
} as const;

export const SPRITE = {
  npcW: 16,
  npcH: 24,
  toolIcon: 16,
  modeIcon: 12,
  staminaGlyph: 8,
} as const;

// PIXI tints are 0xRRGGBB numbers. CSS vars are #RRGGBB strings.
// When a sprite needs to be tinted from CSS var, also expose the numeric form here.
export const PALETTE = {
  bgDeep: 0x060814,
  bgMidnight: 0x0a0d1c,
  bgIndigo: 0x1a1f3a,
  bgViolet: 0x2a2046,
  torch: 0xe8a541,
  torchGlow: 0xffd16a,
  ember: 0xc4413c,
  parchment: 0xefe1c0,
  moonlit: 0xd8d2e8,
} as const;

export type Palette = typeof PALETTE;

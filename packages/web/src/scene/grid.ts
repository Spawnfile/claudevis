// packages/web/src/scene/grid.ts
import { TILE } from './theme';

/**
 * Convert iso tile coordinates (col, row) to screen pixel coordinates.
 * Origin (0, 0) → screen (0, 0). The classic 2:1 iso projection.
 */
export function tileToScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * (TILE.w / 2),
    y: (col + row) * (TILE.h / 2),
  };
}

/**
 * NPC tile slots inside the village's open central area. Slots are picked
 * to avoid cottage/lantern/well placements (see scene.ts createVillageBackdrop).
 * Spread out across the central 5×5 grid (col -2..2, row -2..2) — stays inside
 * the grass-tile zone, away from buildings.
 *
 * M3c.2b extends this for subagent recursion stacks (rows above the parent).
 */
const NPC_SLOTS: ReadonlyArray<{ col: number; row: number }> = [
  { col: 0, row: 0 },
  { col: 1, row: 1 },
  { col: -1, row: 1 },
  { col: 1, row: -1 },
  { col: -1, row: -1 },
  { col: 0, row: 2 },
  { col: 2, row: 0 },
  { col: -2, row: 0 },
];

export function npcLayoutSlot(sessionIdx: number): { col: number; row: number } {
  return NPC_SLOTS[sessionIdx % NPC_SLOTS.length] ?? { col: 0, row: 0 };
}

// packages/web/test/scene/grid.test.ts
import { describe, expect, it } from 'vitest';
import { npcLayoutSlot, tileToScreen } from '../../src/scene/grid';

describe('grid.tileToScreen', () => {
  it('places (0, 0) at origin', () => {
    expect(tileToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('places (1, 0) at (32, 16)', () => {
    expect(tileToScreen(1, 0)).toEqual({ x: 32, y: 16 });
  });

  it('places (0, 1) at (-32, 16)', () => {
    expect(tileToScreen(0, 1)).toEqual({ x: -32, y: 16 });
  });

  it('places (1, 1) at (0, 32)', () => {
    expect(tileToScreen(1, 1)).toEqual({ x: 0, y: 32 });
  });

  it('places (3, 2) correctly', () => {
    expect(tileToScreen(3, 2)).toEqual({ x: 32, y: 80 });
  });
});

describe('grid.npcLayoutSlot', () => {
  it('places session 0 at the village center', () => {
    expect(npcLayoutSlot(0)).toEqual({ col: 0, row: 0 });
  });

  it('places session 1 at (1, 1)', () => {
    expect(npcLayoutSlot(1)).toEqual({ col: 1, row: 1 });
  });

  it('places session 4 at (-1, -1)', () => {
    expect(npcLayoutSlot(4)).toEqual({ col: -1, row: -1 });
  });

  it('wraps around when index exceeds slot count', () => {
    // 8 slots — index 8 wraps to slot 0
    expect(npcLayoutSlot(8)).toEqual({ col: 0, row: 0 });
    expect(npcLayoutSlot(9)).toEqual({ col: 1, row: 1 });
  });
});

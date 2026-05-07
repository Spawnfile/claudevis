import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// packages/web/test/scene/sprite-manifest.test.ts
import { describe, expect, it } from 'vitest';
import { SPRITES } from '../../src/scene/sprite-manifest';

describe('sprite-manifest', () => {
  // Convert /sprites/npc.svg → packages/web/public/sprites/npc.svg
  const toFsPath = (manifestPath: string) =>
    resolve(__dirname, '../../public', manifestPath.replace(/^\//, ''));

  for (const [name, manifestPath] of Object.entries(SPRITES)) {
    it(`SPRITES.${name} (${manifestPath}) resolves to an existing file in public/`, () => {
      const fs = toFsPath(manifestPath);
      expect(existsSync(fs)).toBe(true);
    });
  }
});

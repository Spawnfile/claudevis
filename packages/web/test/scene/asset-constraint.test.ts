import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
// packages/web/test/scene/asset-constraint.test.ts
import { describe, expect, it } from 'vitest';

const spritesDir = resolve(__dirname, '../../public/sprites');

const ALLOWED_ELEMENTS = new Set(['svg', 'g', 'title', 'desc', 'rect', 'polygon', 'line']);

const FORBIDDEN_ELEMENTS = [
  'circle',
  'ellipse',
  'path',
  'image',
  'text',
  'use',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
];

describe('asset constraint enforcement', () => {
  let files: string[] = [];
  try {
    files = readdirSync(spritesDir).filter((f) => f.endsWith('.svg'));
  } catch {
    files = [];
  }

  it('finds at least one SVG sprite', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    describe(file, () => {
      const fullPath = join(spritesDir, file);
      let content = '';
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        content = '';
      }

      it('uses a viewBox', () => {
        expect(content).toMatch(/viewBox\s*=\s*["'][^"']+["']/);
      });

      it.each(FORBIDDEN_ELEMENTS)('does not contain forbidden element <%s>', (el) => {
        // [\s>/] also catches self-closing form e.g. `<circle/>` per T6 review.
        const re = new RegExp(`<${el}[\\s>/]`);
        expect(content).not.toMatch(re);
      });

      it('every used element is in the allowed list', () => {
        const usedElements = new Set<string>();
        const re = /<([a-zA-Z]+)[\s>/]/g;
        let match = re.exec(content);
        while (match !== null) {
          const tag = match[1];
          if (tag !== undefined) usedElements.add(tag);
          match = re.exec(content);
        }
        for (const el of usedElements) {
          if (el === 'xml' || el === '?xml') continue;
          expect(ALLOWED_ELEMENTS, `<${el}> in ${file}`).toContain(el);
        }
      });
    });
  }
});

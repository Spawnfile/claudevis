import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// packages/web/test/scene/theme.test.ts
import { describe, expect, it } from 'vitest';

const stylesPath = resolve(__dirname, '../../src/styles.css');
const css = readFileSync(stylesPath, 'utf-8');

describe('theme palette in styles.css', () => {
  // Extract :root block contents (first occurrence)
  const rootMatch = css.match(/:root\s*\{([^}]*)\}/);
  const rootBlock = rootMatch?.[1] ?? '';

  it.each([
    ['--bg-deep', '#060814'],
    ['--bg-midnight', '#0a0d1c'],
    ['--bg-indigo', '#1a1f3a'],
    ['--bg-violet', '#2a2046'],
    ['--torch', '#e8a541'],
    ['--torch-glow', '#ffd16a'],
    ['--ember', '#c4413c'],
    ['--parchment', '#efe1c0'],
    ['--moonlit', '#d8d2e8'],
    ['--torch-alpha-18', 'rgba(232, 165, 65, 0.18)'],
    ['--line', 'var(--torch-alpha-18)'],
  ])('defines %s with value %s', (name, value) => {
    const re = new RegExp(
      `${name.replace(/-/g, '\\-')}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*;`,
    );
    expect(rootBlock).toMatch(re);
  });

  it('defines model lore-color CSS variables', () => {
    expect(rootBlock).toMatch(/--model-haiku\s*:\s*#7090a8\s*;/);
    expect(rootBlock).toMatch(/--model-sonnet\s*:\s*#c2693f\s*;/);
    expect(rootBlock).toMatch(/--model-opus\s*:\s*#c9a96e\s*;/);
  });

  it('defines mode lore-color CSS variables', () => {
    expect(rootBlock).toMatch(/--mode-headstrong\s*:\s*#8b1f1a\s*;/);
    expect(rootBlock).toMatch(/--mode-cartographer\s*:\s*#5a4f8a\s*;/);
    expect(rootBlock).toMatch(/--mode-trusting\s*:\s*#7d8c3d\s*;/);
    expect(rootBlock).toMatch(/--mode-wary\s*:\s*#3a4d6a\s*;/);
  });
});

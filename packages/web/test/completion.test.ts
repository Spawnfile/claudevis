import type { SkillEntry } from '@claudevis/shared';
import { describe, expect, it } from 'vitest';
import { filterCatalog } from '../src/completion.js';

const buildEntry = (overrides: Partial<SkillEntry> = {}): SkillEntry => ({
  name: 'sample',
  description: '',
  source: 'user',
  path: '',
  kind: 'skill',
  ...overrides,
});

describe('filterCatalog', () => {
  it('returns [] when catalog is null', () => {
    expect(filterCatalog(null, '/foo')).toEqual([]);
  });

  it('returns full catalog when query is empty after stripping leading slash', () => {
    const catalog = [buildEntry({ name: 'a' }), buildEntry({ name: 'b' })];
    expect(filterCatalog(catalog, '/')).toEqual(catalog);
  });

  it('returns full catalog when query is empty string', () => {
    const catalog = [buildEntry({ name: 'a' }), buildEntry({ name: 'b' })];
    expect(filterCatalog(catalog, '')).toEqual(catalog);
  });

  it('returns full catalog when query is whitespace-only after slash strip', () => {
    const catalog = [buildEntry({ name: 'a' })];
    expect(filterCatalog(catalog, '/   ')).toEqual(catalog);
  });

  it('matches case-insensitive name substring', () => {
    const catalog = [
      buildEntry({ name: 'foo-skill' }),
      buildEntry({ name: 'bar-skill' }),
      buildEntry({ name: 'baz-skill' }),
    ];
    expect(filterCatalog(catalog, '/FOO').map((e) => e.name)).toEqual(['foo-skill']);
  });

  it('matches across all kinds and sources', () => {
    const catalog = [
      buildEntry({ name: 'plan', kind: 'slash_command' }),
      buildEntry({ name: 'planner', kind: 'agent' }),
      buildEntry({ name: 'plankton-quality', kind: 'skill', source: 'plugin' }),
    ];
    expect(filterCatalog(catalog, '/plan').map((e) => e.name)).toEqual([
      'plan',
      'planner',
      'plankton-quality',
    ]);
  });

  it('preserves catalog source order in results', () => {
    const catalog = [
      buildEntry({ name: 'z-zebra' }),
      buildEntry({ name: 'a-apple' }),
      buildEntry({ name: 'm-mango' }),
    ];
    expect(filterCatalog(catalog, '').map((e) => e.name)).toEqual([
      'z-zebra',
      'a-apple',
      'm-mango',
    ]);
  });

  it('matches plugin-namespace separator entries', () => {
    const catalog = [
      buildEntry({ name: 'plugin-a:test-skill' }),
      buildEntry({ name: 'plugin-b:test-skill' }),
    ];
    expect(filterCatalog(catalog, '/plugin-a:').map((e) => e.name)).toEqual([
      'plugin-a:test-skill',
    ]);
  });

  it('returns [] when no entry matches', () => {
    const catalog = [buildEntry({ name: 'foo' })];
    expect(filterCatalog(catalog, '/zzz')).toEqual([]);
  });

  it('accepts query without leading slash', () => {
    const catalog = [buildEntry({ name: 'foo-skill' })];
    expect(filterCatalog(catalog, 'foo').map((e) => e.name)).toEqual(['foo-skill']);
  });
});

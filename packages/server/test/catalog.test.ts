import { describe, expect, it } from 'bun:test';
import { buildSkillEntries, extractInvokableNames } from '../src/catalog.js';

describe('buildSkillEntries', () => {
  it('maps skills array entries to SkillEntry with kind=skill', () => {
    const result = buildSkillEntries({
      skills: ['my-skill'],
      slash_commands: [],
      agents: [],
      plugins: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'my-skill',
      description: '',
      path: '',
      source: 'user',
      kind: 'skill',
    });
  });

  it('maps slash_commands array entries to SkillEntry with kind=slash_command', () => {
    const result = buildSkillEntries({
      skills: [],
      slash_commands: ['my-cmd'],
      agents: [],
      plugins: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('slash_command');
    expect(result[0]?.name).toBe('my-cmd');
  });

  it('maps agents array entries to SkillEntry with kind=agent', () => {
    const result = buildSkillEntries({
      skills: [],
      slash_commands: [],
      agents: ['my-agent'],
      plugins: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('agent');
    expect(result[0]?.name).toBe('my-agent');
  });

  it('infers source=plugin when name has a colon prefix matching a plugin name', () => {
    const result = buildSkillEntries({
      skills: ['plugin-a:foo', 'bare-skill'],
      slash_commands: [],
      agents: [],
      plugins: [{ name: 'plugin-a', path: '/some/path', source: 'official' }],
    });
    expect(result.find((e) => e.name === 'plugin-a:foo')?.source).toBe('plugin');
    expect(result.find((e) => e.name === 'bare-skill')?.source).toBe('user');
  });

  it('returns source=user when colon prefix does not match any plugin', () => {
    const result = buildSkillEntries({
      skills: ['unknown-prefix:foo'],
      slash_commands: [],
      agents: [],
      plugins: [{ name: 'plugin-a', path: '/p', source: 'official' }],
    });
    expect(result[0]?.source).toBe('user');
  });

  it('drops non-string entries from name arrays', () => {
    const result = buildSkillEntries({
      skills: ['valid', 42 as unknown as string, null as unknown as string],
      slash_commands: [],
      agents: [],
      plugins: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('valid');
  });

  it('returns empty array when all source arrays are empty', () => {
    const result = buildSkillEntries({
      skills: [],
      slash_commands: [],
      agents: [],
      plugins: [],
    });
    expect(result).toEqual([]);
  });

  it('preserves entry order: skills then slash_commands then agents', () => {
    const result = buildSkillEntries({
      skills: ['s1'],
      slash_commands: ['c1'],
      agents: ['a1'],
      plugins: [],
    });
    expect(result.map((e) => e.kind)).toEqual(['skill', 'slash_command', 'agent']);
  });

  it('handles malformed plugin entries gracefully (missing name field)', () => {
    const result = buildSkillEntries({
      skills: ['valid-skill'],
      slash_commands: [],
      agents: [],
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
      plugins: [{} as any, { name: 'plugin-ok', path: '/p', source: 'x' }, null as any],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('user'); // 'valid-skill' has no colon, so source=user regardless
  });
});

describe('extractInvokableNames', () => {
  it('returns a Set of all entry names', () => {
    const entries = [
      { name: 's1', description: '', source: 'user' as const, path: '', kind: 'skill' as const },
      {
        name: 'c1',
        description: '',
        source: 'user' as const,
        path: '',
        kind: 'slash_command' as const,
      },
    ];
    const names = extractInvokableNames(entries);
    expect(names.has('s1')).toBe(true);
    expect(names.has('c1')).toBe(true);
    expect(names.size).toBe(2);
  });

  it('returns an empty Set for empty input', () => {
    expect(extractInvokableNames([]).size).toBe(0);
  });
});

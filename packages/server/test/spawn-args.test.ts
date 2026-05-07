import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { buildSpawnArgs, expandTilde } from '../src/spawn-args.js';

describe('buildSpawnArgs', () => {
  const baseArgs = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'];

  it('appends --model to the base args', () => {
    expect(buildSpawnArgs({ baseArgs, model: 'sonnet' })).toEqual([
      ...baseArgs,
      '--model',
      'sonnet',
    ]);
  });

  it('appends --resume after --model when resume is provided', () => {
    expect(buildSpawnArgs({ baseArgs, model: 'opus', resume: 'sess-abc' })).toEqual([
      ...baseArgs,
      '--model',
      'opus',
      '--resume',
      'sess-abc',
    ]);
  });

  it('preserves base args order', () => {
    const out = buildSpawnArgs({ baseArgs, model: 'haiku' });
    expect(out.slice(0, baseArgs.length)).toEqual(baseArgs);
  });
});

describe('expandTilde', () => {
  it('expands "~" to homedir', () => {
    expect(expandTilde('~')).toBe(homedir());
  });

  it('expands "~/foo" to "<home>/foo"', () => {
    expect(expandTilde('~/foo')).toBe(`${homedir()}/foo`);
  });

  it('expands "~/" to "<home>/"', () => {
    expect(expandTilde('~/')).toBe(`${homedir()}/`);
  });

  it('does NOT expand "~user" (other-user home)', () => {
    expect(expandTilde('~alice/foo')).toBe('~alice/foo');
  });

  it('does NOT expand absolute paths', () => {
    expect(expandTilde('/etc/passwd')).toBe('/etc/passwd');
  });

  it('does NOT expand relative paths', () => {
    expect(expandTilde('./local')).toBe('./local');
  });

  it('preserves the empty string', () => {
    expect(expandTilde('')).toBe('');
  });

  it('preserves the dot', () => {
    expect(expandTilde('.')).toBe('.');
  });
});

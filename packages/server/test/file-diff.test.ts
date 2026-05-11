import { describe, expect, it } from 'bun:test';
import { computeFileDiff, parseGitNumstat } from '../src/file-diff.js';

describe('parseGitNumstat', () => {
  it('returns 0/0 for empty input', () => {
    expect(parseGitNumstat('')).toEqual({ plus: 0, minus: 0 });
  });

  it('parses standard <plus>\t<minus>\t<path>', () => {
    expect(parseGitNumstat('5\t3\tdemo.ts\n')).toEqual({ plus: 5, minus: 3 });
  });

  it('returns 0/0 for binary placeholder "-\t-\t..."', () => {
    expect(parseGitNumstat('-\t-\timg.png\n')).toEqual({ plus: 0, minus: 0 });
  });

  it('skips empty leading lines', () => {
    expect(parseGitNumstat('\n\n7\t2\tsrc.ts\n')).toEqual({ plus: 7, minus: 2 });
  });

  it('uses only the first non-empty line', () => {
    expect(parseGitNumstat('1\t1\ta\n9\t9\tb\n')).toEqual({ plus: 1, minus: 1 });
  });
});

describe('computeFileDiff', () => {
  it('returns 0/0 when runner returns null', () => {
    const result = computeFileDiff('/cwd', 'demo.ts', () => null);
    expect(result).toEqual({ plus: 0, minus: 0 });
  });

  it('parses runner stdout', () => {
    const result = computeFileDiff('/cwd', 'demo.ts', (cwd, path) => {
      expect(cwd).toBe('/cwd');
      expect(path).toBe('demo.ts');
      return '12\t4\tdemo.ts\n';
    });
    expect(result).toEqual({ plus: 12, minus: 4 });
  });
});

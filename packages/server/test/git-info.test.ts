import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectGitInfo } from '../src/git-info.js';

const initRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'claudevis-git-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), 'x');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
};

describe('detectGitInfo', () => {
  it('returns repo basename and branch for a git repo', () => {
    const dir = initRepo();
    const info = detectGitInfo(dir);
    expect(info.repo).toBe(dir.split('/').pop()!);
    expect(info.branch).toBe('main');
  });

  it('returns empty info for a non-git directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claudevis-nogit-'));
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const info = detectGitInfo(join(dir, 'sub'));
    expect(info.repo).toBeUndefined();
    expect(info.branch).toBeUndefined();
  });
});

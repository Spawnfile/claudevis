import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

export interface GitInfo {
  repo?: string;
  branch?: string;
}

export function detectGitInfo(cwd: string): GitInfo {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: top,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { repo: basename(top), branch: branch || undefined };
  } catch {
    return {};
  }
}

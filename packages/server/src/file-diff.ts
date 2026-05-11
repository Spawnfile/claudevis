export interface DiffResult {
  plus: number;
  minus: number;
}

export type GitDiffRunner = (cwd: string, path: string) => string | null;

export function parseGitNumstat(stdout: string): DiffResult {
  const line = stdout.split('\n').find((l) => l.trim().length > 0);
  if (!line) return { plus: 0, minus: 0 };
  const [p, m] = line.split('\t');
  const plus = Number.parseInt(p ?? '', 10);
  const minus = Number.parseInt(m ?? '', 10);
  return {
    plus: Number.isFinite(plus) ? plus : 0,
    minus: Number.isFinite(minus) ? minus : 0,
  };
}

export function computeFileDiff(cwd: string, path: string, run: GitDiffRunner): DiffResult {
  const stdout = run(cwd, path);
  if (stdout === null) return { plus: 0, minus: 0 };
  return parseGitNumstat(stdout);
}

/**
 * Production runner — shells `git diff --numstat HEAD -- <path>` via Bun.spawnSync
 * with a 1s timeout. Returns the raw stdout, or null on non-zero exit, timeout,
 * or shell-out failure (e.g. `git` not on PATH, cwd not a repo).
 */
export const bunGitDiffRunner: GitDiffRunner = (cwd, path) => {
  try {
    const proc = Bun.spawnSync(['git', 'diff', '--numstat', 'HEAD', '--', path], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 1000,
    });
    if (proc.exitCode !== 0) return null;
    return new TextDecoder().decode(proc.stdout);
  } catch {
    return null;
  }
};

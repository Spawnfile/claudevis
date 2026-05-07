import { homedir } from 'node:os';

export interface BuildSpawnArgsInput {
  baseArgs: ReadonlyArray<string>;
  model: string;
  resume?: string;
}

/**
 * Builds the argv tail for a `claude` subprocess spawn. Pure function;
 * no env or fs reads. The caller passes the base flags (--output-format
 * stream-json etc.) and we append --model plus optional --resume.
 */
export function buildSpawnArgs({ baseArgs, model, resume }: BuildSpawnArgsInput): string[] {
  const out = [...baseArgs, '--model', model];
  if (resume) {
    out.push('--resume', resume);
  }
  return out;
}

/**
 * Expands a leading `~` or `~/` in a user-supplied path to the current
 * user's home directory. Other-user expansion (`~alice/foo`) is NOT
 * supported — POSIX `pwd.h` lookups are out of scope for v1. Absolute
 * paths and relative paths pass through untouched.
 */
export function expandTilde(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return `${homedir()}${path.slice(1)}`;
  return path;
}

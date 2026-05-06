import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

export interface SubprocessHandle {
  pid: number;
  write(obj: unknown): void;
  onLine(fn: (line: unknown) => void): void;
  onExit(fn: (code: number | null) => void): void;
  close(): Promise<void>;
  signal(sig: NodeJS.Signals): void;
}

export interface SubprocessOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Optional eager line listener — registered BEFORE stdout is consumed so
   * the very first line emitted by the child cannot be lost to a race
   * between subprocess startup and the caller wiring `onLine` afterwards.
   * Required by SessionManager so `session.started` is never dropped.
   */
  onLine?: (line: unknown) => void;
}

export function spawnSubprocess(opts: SubprocessOptions): SubprocessHandle {
  const lineSubs: Array<(line: unknown) => void> = [];
  if (opts.onLine) lineSubs.push(opts.onLine);
  const exitSubs: Array<(code: number | null) => void> = [];
  let buf = '';

  const child: ChildProcessWithoutNullStreams = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    for (let idx = buf.indexOf('\n'); idx >= 0; idx = buf.indexOf('\n')) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        for (const fn of lineSubs) fn(parsed);
      } catch {
        // log non-JSON for debugging — silently ignore for now
      }
    }
  });

  child.on('exit', (code) => {
    for (const fn of exitSubs) fn(code);
  });

  return {
    pid: child.pid ?? -1,
    write: (obj) => {
      child.stdin.write(`${JSON.stringify(obj)}\n`);
    },
    onLine: (fn) => {
      lineSubs.push(fn);
    },
    onExit: (fn) => {
      exitSubs.push(fn);
    },
    close: () =>
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.stdin.end();
        setTimeout(() => {
          if (!child.killed) child.kill('SIGTERM');
        }, 500);
      }),
    signal: (sig) => child.kill(sig),
  };
}

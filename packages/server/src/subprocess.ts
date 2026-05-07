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
        // Non-JSON line on stdout — surface so we can diagnose subprocesses
        // that print plaintext errors / banners to stdout instead of NDJSON.
        console.error(`[claudevis] subprocess stdout (non-JSON): ${line.slice(0, 500)}`);
      }
    }
  });

  // stderr was previously discarded. Surface every stderr chunk so claude's
  // error messages, auth prompts, and warnings actually reach the developer.
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const text = String(chunk).trimEnd();
    if (text) console.error(`[claudevis] subprocess stderr: ${text}`);
  });

  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[claudevis] subprocess exit code=${code} signal=${signal ?? '-'}`);
    }
    for (const fn of exitSubs) fn(code);
  });

  child.on('error', (err) => {
    console.error(`[claudevis] subprocess error: ${err.message}`);
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
        // If the child already exited before close() was called, the 'exit'
        // event has already fired and won't fire again — resolve immediately
        // so we don't hang.
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        try {
          child.stdin.end();
        } catch {
          // stdin may already be closed if the child died mid-shutdown
        }
        setTimeout(() => {
          if (!child.killed) child.kill('SIGTERM');
        }, 500);
      }),
    signal: (sig) => child.kill(sig),
  };
}

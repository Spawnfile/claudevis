import { describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSubprocess } from '../src/subprocess.js';

const RUN = process.env.CLAUDEVIS_RUN_REAL === '1';
const FIXTURE_DIR = join(import.meta.dir, 'fixtures', 'real-claude-captures');
// Use the package directory (one level above test/) as cwd so the prompt for
// reading package.json lands on a deterministic file regardless of where the
// runner was invoked.
const PROBE_CWD = join(import.meta.dir, '..');

interface ProbeScenario {
  name: string;
  prompts: string[];
  /** ms to wait after the last prompt before SIGINT */
  settleMs: number;
  /**
   * Extra spawn args appended to the base stream-json invocation. Used by
   * the M3b.1 probe to override permission mode. Optional; default scenarios
   * pass nothing extra.
   */
  extraArgs?: string[];
}

const scenarios: ProbeScenario[] = [
  { name: 'greeting', prompts: ['Reply with exactly the word: hello'], settleMs: 15_000 },
  {
    name: 'tool-read',
    prompts: ['Read the file package.json and tell me the "name" field. Do not modify anything.'],
    settleMs: 30_000,
  },
  {
    name: 'error',
    prompts: ['{not valid JSON for forcing a parse error path}'],
    settleMs: 5_000,
  },
  {
    name: 'edit-file',
    prompts: [
      'Use the Write tool to create the file /tmp/claudevis-m3a-probe.txt with the contents "hello m3a". Do not read it first.',
    ],
    settleMs: 30_000,
  },
  {
    name: 'subagent-task',
    prompts: [
      'Use the Task tool to dispatch the planner subagent with the prompt "outline a hello-world feature in two short bullet points". Wait for the subagent to return before doing anything else.',
    ],
    settleMs: 90_000,
  },
  {
    name: 'permission-bash',
    prompts: [
      'Use the Bash tool to run "echo hi > ./m3b-probe.txt". Do not ask for clarification — just run it.',
    ],
    // claude --permission-mode default disables auto-accept so a Bash write
    // should trigger the permission flow (if stream-json carries it).
    extraArgs: ['--permission-mode', 'default'],
    settleMs: 60_000,
  },
];

async function runScenario(s: ProbeScenario): Promise<Array<Record<string, unknown>>> {
  const baseArgs = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'];
  const args = s.extraArgs ? [...baseArgs, ...s.extraArgs] : baseArgs;
  const sub = spawnSubprocess({
    command: 'claude',
    args,
    cwd: PROBE_CWD,
  });
  const lines: Array<Record<string, unknown>> = [];
  sub.onLine((l) => {
    if (l !== null && typeof l === 'object') lines.push(l as Record<string, unknown>);
  });

  try {
    for (const text of s.prompts) {
      sub.write({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
      });
    }
    await new Promise((r) => setTimeout(r, s.settleMs));
    sub.signal('SIGINT');
  } finally {
    // Always wait for the child to exit, even if write/sleep threw — the
    // close() in subprocess.ts is now safe to call after exit.
    await sub.close();
  }
  return lines;
}

function writeFixture(name: string, lines: Array<Record<string, unknown>>): void {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, `${name}.ndjson`);
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  console.log(`[probe] ${name}: ${lines.length} lines -> ${path}`);
}

// Asserts the captured stream contains at least one system/init event so we
// know the probe actually connected to claude rather than catching only an
// early error line.
function assertProbeConnected(lines: Array<Record<string, unknown>>, name: string): void {
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init');
  if (!init) {
    throw new Error(
      `[probe:${name}] no system/init line captured — stream-json mode never connected. Captured ${lines.length} line(s).`,
    );
  }
}

describe.skipIf(!RUN)('real claude probe (CLAUDEVIS_RUN_REAL=1)', () => {
  for (const s of scenarios) {
    it(`captures stream-json for scenario: ${s.name}`, async () => {
      const lines = await runScenario(s);
      writeFixture(s.name, lines);
      expect(lines.length).toBeGreaterThan(0);
      assertProbeConnected(lines, s.name);
    }, 120_000);
  }
});

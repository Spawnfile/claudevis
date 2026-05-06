import { describe, expect, it } from 'bun:test';
import { spawnSubprocess } from '../src/subprocess.js';

const RUN = process.env.CLAUDEVIS_RUN_REAL === '1';

describe.skipIf(!RUN)('real claude probe (CLAUDEVIS_RUN_REAL=1)', () => {
  it('captures stream-json output for 10 seconds', async () => {
    const sub = spawnSubprocess({
      command: 'claude',
      args: ['--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'],
      cwd: process.cwd(),
    });
    const lines: unknown[] = [];
    sub.onLine((l) => lines.push(l));

    sub.write({ type: 'user', content: 'say hello' });
    await new Promise((r) => setTimeout(r, 10_000));
    sub.signal('SIGINT');
    await sub.close();

    console.log(JSON.stringify(lines, null, 2));
    expect(lines.length).toBeGreaterThan(0);
  }, 30_000);
});

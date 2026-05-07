import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const REAL = process.env.CLAUDEVIS_RUN_REAL === '1';
// In real mode, do NOT set CLAUDEVIS_FAKE_CLAUDE so index.ts defaults to real.
const fakeEnv = REAL ? '' : 'CLAUDEVIS_FAKE_CLAUDE=1 ';

// M3b.3 T5: pre-populate a synthetic projects dir so the e2e suite can assert
// the Resumable section renders. We create the tmp dir at config evaluation
// time (sync IO, runs before Playwright spawns webServer) and embed the path
// as an env-prefix on the server command. One synthetic session under the
// encoded cwd `-tmp-fake-resumable-cwd` (decodes to /tmp/fake/resumable/cwd)
// with id `fake-session-uuid-12345` (display name → `resumed-fake-ses`).
const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudevis-e2e-projects-'));
const cwdDir = path.join(projectsDir, '-tmp-fake-resumable-cwd');
fs.mkdirSync(cwdDir, { recursive: true });
fs.writeFileSync(
  path.join(cwdDir, 'fake-session-uuid-12345.jsonl'),
  `${JSON.stringify({ type: 'system', subtype: 'init', model: 'sonnet' })}\n`,
);
const projectsDirEnv = `CLAUDEVIS_PROJECTS_DIR=${projectsDir} `;

export default defineConfig({
  testDir: './e2e',
  // Real mode talks to a live model — give it more wall time per test.
  timeout: REAL ? 120_000 : 30_000,
  webServer: [
    {
      command: `${fakeEnv}${projectsDirEnv}CLAUDEVIS_DB=:memory: CLAUDEVIS_PORT=7879 bun ../server/src/index.ts`,
      port: 7879,
      reuseExistingServer: false,
    },
    {
      command: 'VITE_CLAUDEVIS_PORT=7879 vite --port 5174',
      port: 5174,
      reuseExistingServer: false,
    },
  ],
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
});

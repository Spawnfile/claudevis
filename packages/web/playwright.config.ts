import { defineConfig } from '@playwright/test';

const REAL = process.env.CLAUDEVIS_RUN_REAL === '1';
// In real mode, do NOT set CLAUDEVIS_FAKE_CLAUDE so index.ts defaults to real.
const fakeEnv = REAL ? '' : 'CLAUDEVIS_FAKE_CLAUDE=1 ';

export default defineConfig({
  testDir: './e2e',
  // Real mode talks to a live model — give it more wall time per test.
  timeout: REAL ? 120_000 : 30_000,
  webServer: [
    {
      command: `${fakeEnv}CLAUDEVIS_DB=:memory: CLAUDEVIS_PORT=7879 bun ../server/src/index.ts`,
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

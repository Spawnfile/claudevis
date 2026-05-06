import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  webServer: [
    {
      command:
        'CLAUDEVIS_FAKE_CLAUDE=1 CLAUDEVIS_DB=:memory: CLAUDEVIS_PORT=7879 bun ../server/src/index.ts',
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

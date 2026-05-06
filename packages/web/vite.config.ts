import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// VITE_CLAUDEVIS_PORT lets Playwright (and other deploys) target a non-default
// backend port; defaults to the runtime's 7878.
const backendPort = process.env.VITE_CLAUDEVIS_PORT ?? '7878';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind on all interfaces so Windows browsers (WSL2), other LAN devices,
    // and tunnels can reach the dev server. Without this, only loopback
    // works inside WSL.
    host: true,
    port: 5173,
    // Same-origin WebSocket proxy: the browser opens ws://<host>:5173/v1 and
    // Vite forwards it to the backend on `backendPort`. This avoids the
    // "second port is not forwarded" trap on WSL2 / containers / cloud IDEs.
    proxy: {
      '/v1': {
        target: `ws://127.0.0.1:${backendPort}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./test/setup.ts'],
    // Vitest's default include glob would otherwise pick up
    // `e2e/**/*.spec.ts` (Playwright tests) and try to run them with
    // Vitest, which fails because @playwright/test exports a different
    // API. Keep Vitest scoped to test/** only.
    include: ['test/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});

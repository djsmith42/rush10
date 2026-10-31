import { defineConfig } from '@playwright/test';
import { API_PORT, DATABASE_PATH, REPORT_DIR, ROOT, WEB_DIR, WEB_PORT, WEB_URL } from './lib/env';

export default defineConfig({
  testDir: './tests',
  outputDir: `${REPORT_DIR}/.results`,
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 6),
  timeout: 30_000,
  expect: { timeout: 6_000 },
  reporter: [['list'], ['./lib/album-reporter.ts']],
  globalSetup: './lib/global-setup.ts',
  use: { baseURL: WEB_URL, trace: 'off', screenshot: 'off', video: 'off' },
  webServer: [
    {
      command: 'node e2e/api-server.mjs',
      cwd: ROOT,
      port: API_PORT,
      env: { PORT: String(API_PORT), DATABASE_PATH, NODE_ENV: 'production', LOG_LEVEL: 'warn' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // A production build (about a second) loads far faster per page than the dev server's unbundled modules.
      command: `pnpm --filter @workspace/rush-10 exec vite build --config vite.config.ts --outDir ${WEB_DIR} --emptyOutDir --logLevel error`
        + ` && pnpm --filter @workspace/rush-10 exec vite preview --config vite.config.ts --outDir ${WEB_DIR} --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: ROOT,
      url: WEB_URL,
      // Preview reuses the dev server's /api proxy, pointed at the suite's API.
      env: { API_PORT: String(API_PORT), PORT: String(WEB_PORT), BASE_PATH: '/' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});

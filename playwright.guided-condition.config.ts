import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'guided-condition.spec.ts',
  workers: 1,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8097', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  // The component harness has a fixed non-live transport target. Do not inherit
  // the operator's .env or run against a previously opened application server.
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --port 8097 --strictPort',
    env: { VITE_SUPABASE_URL: 'https://guided-condition-test.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'browser-test-anon', VITE_GUIDED_CONDITIONS: 'true' },
    url: 'http://localhost:8097', reuseExistingServer: false, timeout: 60000,
  },
});

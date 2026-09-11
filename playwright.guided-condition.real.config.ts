import { defineConfig, devices } from '@playwright/test';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !anonKey || !process.env.GUIDED_PREVIEW_REF) {
  throw new Error('Real guided browser tests require an explicitly verified preview');
}

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'guided-condition-real.spec.ts',
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:8098',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --port 8098 --strictPort',
    env: {
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
      VITE_GUIDED_CONDITIONS: 'true',
    },
    url: 'http://localhost:8098',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'typography.spec.ts',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8097',
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'chrome',
  },
  webServer: {
    command: 'npx vite --config tests/browser/chat-typography/vite.config.ts',
    cwd: '../../..',
    url: 'http://127.0.0.1:8097/tests/browser/chat-typography/index.html',
    reuseExistingServer: !process.env.CI,
  },
});

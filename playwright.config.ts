import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, '.playwright-auth/user.json');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.PW_BASE_URL || 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['setup'],
      // O harness de pixel é SEM-AUTH de propósito (roda no projeto 'pixel');
      // não pode passar pelo setup/storageState do chromium.
      testIgnore: ['**/auth.setup.ts', '**/tv-wall-pixel.spec.ts'],
    },
    {
      // Harness de pixel da parede (#1254 acabamento): dev-only, /tv-wall-preview
      // renderiza sem auth → SEM dependency 'setup' e SEM storageState. 1920x1080.
      name: 'pixel',
      testMatch: '**/tv-wall-pixel.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        storageState: undefined,
      },
    },
  ],
  webServer: {
    command: process.env.CI ? 'npx serve -s dist -l 8080' : 'npm run dev',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e/portfolio',
  outputDir: '/tmp/torque-portfolio-playwright',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5187', channel: 'chrome', reducedMotion: 'reduce', screenshot: 'only-on-failure' },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 5187 --strictPort', url: 'http://127.0.0.1:5187/clientes-preview.html', reuseExistingServer: !process.env.CI },
});

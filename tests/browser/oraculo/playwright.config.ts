import { defineConfig } from '@playwright/test';
const remote = process.env.TEST_SUPABASE_URL;
if (remote && /jsjsmuncfkbsbzqzqhfq|bcfadphgsibjzivtbjvc/.test(remote)) throw new Error('Disposable branch required');
export default defineConfig({ timeout: 90_000, testDir: '.', testMatch: 'smoke.spec.ts', workers: 1, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8094', headless: true, channel: 'chrome', viewport: { width: 1440, height: 1000 } },
  webServer: [
    ...(!remote ? [{ command: 'deno run --config supabase/functions/deno.json --allow-env --allow-net --allow-read tests/browser/oraculo/server.ts', cwd: '../../..', url: 'http://127.0.0.1:54399/rest/v1/organizations', timeout: 30000 }] : []),
    { command: 'npx vite --host 127.0.0.1 --port 8094 --strictPort', cwd: '../../..', url: 'http://127.0.0.1:8094/tests/browser/oraculo/index.html',
      env: { VITE_SUPABASE_URL: remote ?? 'http://127.0.0.1:54399', VITE_SUPABASE_PUBLISHABLE_KEY: process.env.TEST_SUPABASE_ANON_KEY ?? 'test-anon' }, timeout: 60000 },
  ],
});

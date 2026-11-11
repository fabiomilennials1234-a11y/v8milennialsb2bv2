/**
 * Prova do checkout da Stripe contra o build real, com os headers reais e a Stripe em modo
 * teste. Precisa de chaves de modo teste por variável de processo (nunca em arquivo):
 *
 *   STRIPE_SECRET_KEY=sk_test_... VITE_STRIPE_PUBLISHABLE_KEY=pk_test_... \
 *     npx playwright test -c playwright.checkout.config.ts
 *
 * Fora do `playwright.config.ts` de propósito: cria objetos na conta de teste da Stripe.
 * Sem Docker e sem Supabase local: banco em PGlite (tests/e2e/checkout/harness.mjs).
 */
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CHECKOUT_E2E_PORT ?? 8191);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DIST = process.env.CHECKOUT_E2E_DIST ?? join(tmpdir(), 'torque-checkout-e2e-dist');
process.env.CHECKOUT_E2E_DIST = DIST;

const BUILD_ENV = [
  `VITE_SUPABASE_URL=${ORIGIN}`,
  'VITE_SUPABASE_PROJECT_ID=harness',
  'VITE_SUPABASE_PUBLISHABLE_KEY=chave-publica-do-harness',
  `VITE_SENTRY_DSN=http://publica@127.0.0.1:${PORT}/1`,
].join(' ');

export default defineConfig({
  testDir: './tests/e2e/checkout',
  outputDir: join(tmpdir(), 'torque-checkout-e2e-results'),
  workers: 1,
  fullyParallel: false,
  timeout: 150_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: ORIGIN,
    locale: 'pt-BR',
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  // Com e sem Service Worker: com `block` o defeito do SW que barrava o Stripe.js não aparece.
  projects: [
    { name: 'sw-block', use: { serviceWorkers: 'block' }, testIgnore: '**/sw.spec.ts' },
    { name: 'sw-allow', use: { serviceWorkers: 'allow' } },
  ],
  webServer: {
    command: process.env.CHECKOUT_E2E_SKIP_BUILD
      ? 'node --experimental-transform-types --no-warnings tests/e2e/checkout/harness.mjs'
      : `${BUILD_ENV} node node_modules/vite/bin/vite.js build --outDir "${DIST}" --emptyOutDir && node --experimental-transform-types --no-warnings tests/e2e/checkout/harness.mjs`,
    url: `${ORIGIN}/__t/ping`,
    reuseExistingServer: false,
    timeout: 420_000,
    stdout: 'pipe',
  },
});

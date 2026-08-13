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
    // Harness de pixel da parede (#1254 acabamento): dev-only, /tv-wall-preview
    // renderiza sem auth → SEM dependency 'setup' e SEM storageState. 1920x1080.
    //
    // FORA da rodada padrão, e por um motivo de produto, não de conveniência: a
    // rota `/tv-wall-preview` é dev-only DE PROPÓSITO (`TvWallPreview.tsx`
    // retorna "Não disponível em produção" quando `import.meta.env.DEV` é
    // falso), como as irmãs /tv-renderers-demo e /tv-type-scale — para não
    // vazar harness de QA com fixture no bundle do cliente. O CI, porém, serve
    // `npx serve -s dist`, ou seja BUILD DE PRODUÇÃO: a página responde o aviso,
    // nenhum card monta e o spec estoura em `waitForSelector`. Isso não é bug do
    // produto nem do spec — é o projeto estar inscrito na lista errada.
    //
    // Rodar à mão, como o próprio docstring do spec manda:
    //   npm run dev -- --port 8090
    //   PW_BASE_URL=http://localhost:8090 PW_PIXEL=1 npx playwright test --project=pixel
    ...(process.env.PW_PIXEL
      ? [{
          name: 'pixel',
          testMatch: '**/tv-wall-pixel.spec.ts',
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1920, height: 1080 },
            storageState: undefined,
          },
        }]
      : []),
  ],
  webServer: {
    command: process.env.CI ? 'npx serve -s dist -l 8080' : 'npm run dev',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

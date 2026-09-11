/**
 * Playwright auth setup — logs in once and saves session state.
 * Other tests reuse the saved state to avoid logging in every time.
 *
 * ⚠ ESTE ARQUIVO É O GARGALO DA SUÍTE (SCRUM-363). O projeto `chromium` declara
 * `dependencies: ['setup']`, então quando este teste falha os outros 115 são
 * PULADOS — o job reporta "2 failed" e parece um problema pequeno. Não é: é a
 * suíte inteira não rodando.
 *
 * Por isso a falha aqui precisa DIZER O QUE ACONTECEU. Antes, o único sinal era
 * `TimeoutError: page.waitForURL: Timeout 15000ms exceeded`, que não distingue
 * as três causas possíveis:
 *
 *   1. credencial recusada (o seed não bateu com o que o app manda);
 *   2. a chamada de login nem saiu (Supabase local fora do ar, CSP, URL errada);
 *   3. o login funcionou e o app parou em outra rota (onboarding, master, gestor).
 *
 * As três exigem correções diferentes, e adivinhar custou dois ciclos de CI.
 */

import { test as setup, expect } from '@playwright/test';

const authFile = '.playwright-auth/user.json';

setup('authenticate', async ({ page }) => {
  const erros: string[] = [];
  const respostasDeAuth: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(msg.text());
  });
  page.on('pageerror', (err) => erros.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) => {
    erros.push(`requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', async (res) => {
    if (!res.url().includes('/auth/v1/token')) return;
    let corpo = '';
    try {
      corpo = (await res.text()).slice(0, 300);
    } catch {
      corpo = '(corpo indisponível)';
    }
    respostasDeAuth.push(`${res.status()} ${res.url()} → ${corpo}`);
  });

  await page.goto('/auth');

  // Fill login form (locators robustos: id em vez de placeholder pra senha que usa bullets)
  await page.locator('input#email').fill(process.env.E2E_USER_EMAIL || 'admin@test.com');
  await page.locator('input#password').fill(process.env.E2E_USER_PASSWORD || 'Test123!@#');

  // Submit
  await page.getByRole('button', { name: /entrar|login|sign in/i }).click();

  // Wait for navigation to dashboard or main page
  try {
    await page.waitForURL(/\/(dashboard|leads|follow-ups|$)/, { timeout: 15_000 });
  } catch (e) {
    // O diagnóstico que faltava. Cada linha separa uma das três causas.
    const url = page.url();
    const textoDaTela = (await page.locator('body').innerText().catch(() => '')).slice(0, 600);
    const dica =
      respostasDeAuth.length === 0
        ? 'A chamada de login NÃO SAIU — Supabase local fora do ar, CSP bloqueando, ou VITE_SUPABASE_URL errada no build.'
        : respostasDeAuth.some((r) => r.startsWith('200'))
          ? 'O login FOI ACEITO e o app parou em outra rota — provável gate (onboarding/master/gestor) que a regex não cobre.'
          : 'O login foi RECUSADO — o usuário do seed não bate com E2E_USER_EMAIL/E2E_USER_PASSWORD.';

    throw new Error(
      [
        'auth.setup falhou — e com ele TODA a suíte é pulada (SCRUM-363).',
        `Diagnóstico: ${dica}`,
        `URL parada em: ${url}`,
        `Respostas de /auth/v1/token: ${respostasDeAuth.join(' | ') || '(nenhuma)'}`,
        `Erros de console/rede: ${erros.slice(0, 8).join(' | ') || '(nenhum)'}`,
        `Texto na tela: ${textoDaTela.replace(/\s+/g, ' ')}`,
        `Erro original: ${(e as Error).message}`,
      ].join('\n'),
    );
  }

  // Save signed-in state
  await page.context().storageState({ path: authFile });

  // Sessão salva sem token é a falha silenciosa desta etapa: os 115 testes
  // seguintes rodariam DESLOGADOS e falhariam um a um, cada um com uma
  // mensagem diferente e nenhuma apontando para cá.
  const estado = await page.context().storageState();
  const temSessao = estado.origins.some((o) =>
    o.localStorage.some((item) => item.name.includes('auth-token') && item.value.length > 20),
  );
  expect(
    temSessao,
    'storageState salvo SEM token de sessão — os testes seguintes rodariam deslogados',
  ).toBe(true);
});

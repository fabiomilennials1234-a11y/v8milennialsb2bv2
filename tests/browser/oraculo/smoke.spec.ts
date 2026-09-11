import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
test('pergunta, reabre histórico, troca organização e trata plano recusado', async ({ page }) => {
  const question = `Continue a análise ${Date.now()}`;
  const sessionFile = process.env.ORACULO_SMOKE_SESSION_FILE;
  const credentials = sessionFile ? JSON.parse(readFileSync(sessionFile, 'utf8')) : null;
  await page.addInitScript((credentials) => {
    localStorage.setItem('selected_org_id', '20000000-0000-4000-8000-000000000001');
    localStorage.setItem(credentials?.storageKey ?? 'sb-127-auth-token', JSON.stringify(credentials?.session ?? { access_token: 'test-user', refresh_token: 'test-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer',
      user: { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' } }));
  }, credentials);
  await page.goto('/tests/browser/oraculo/index.html');
  await expect(page.getByRole('heading', { name: 'Oráculo Comercial' })).toBeVisible();
  await page.getByRole('button', { name: 'Conversa existente A' }).click();
  await expect(page.getByText('O contrato confidencial da organização A vale R$ 713.250.')).toBeVisible();
  await page.getByPlaceholder('Pergunte sobre o seu funil…').fill(question);
  const pendingResponse = page.waitForResponse(r => r.url().includes('/functions/v1/oraculo-turno'));
  await page.getByRole('button', { name: 'Perguntar', exact: true }).click();
  const response = await pendingResponse;
  expect(response.status()).toBe(200);
  const answer = (await response.json()).resposta;
  expect(answer.length).toBeGreaterThan(0);
  await expect(page.getByText(answer, { exact: true }).last()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Conversa existente A' }).click();
  await expect(page.getByText(question, { exact: true })).toBeVisible();
  await expect(page.getByText(answer, { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Selecionar organização B' }).click();
  await expect(page.getByText('Nenhuma conversa ainda.')).toBeVisible();
  await expect(page.getByText('O contrato confidencial da organização A vale R$ 713.250.')).toHaveCount(0);
  if (process.env.TEST_SUPABASE_URL) {
    const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
    const denied = await page.request.patch(`${process.env.TEST_SUPABASE_URL}/rest/v1/organizations?id=eq.20000000-0000-4000-8000-000000000002`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, data: { subscription_plan: 'oracle-smoke-blocked' },
    });
    expect(denied.ok(), await denied.text()).toBe(true);
  } else await page.request.post('http://127.0.0.1:54399/qa/deny-plan');
  await page.getByPlaceholder('Pergunte sobre o seu funil…').fill('Pergunta sem plano');
  await page.getByRole('button', { name: 'Perguntar', exact: true }).click();
  await expect(page.getByText('Seu acesso ao Oráculo não está disponível nesta organização. Consulte o administrador.')).toBeVisible();
});

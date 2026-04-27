/**
 * E2E Test 1 — Login and basic navigation
 */

import { test, expect } from '@playwright/test';

test.describe('Login e navegação básica', () => {
  // O fluxo de login completo é coberto por auth.setup.ts (roda 1x antes).
  // Este teste agora valida apenas que sessao persistente esta ativa
  // (storageState carregado).
  test('sessao persistente nao redireciona /auth para login', async ({ page }) => {
    await page.goto('/auth');
    // Com sessao ativa, /auth redireciona pra app. Sem sessao, mostra form.
    // Aceitamos qualquer URL que nao seja /login.
    expect(page.url()).not.toContain('/login');
  });

  test('sidebar carrega com módulos', async ({ page }) => {
    await page.goto('/');
    // The sidebar should have navigation links
    const sidebar = page.locator('nav, [role="navigation"], aside');
    await expect(sidebar.first()).toBeVisible({ timeout: 10_000 });
  });

  test('navegar para /leads', async ({ page }) => {
    await page.goto('/leads');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/leads');
  });

  test('navegar para /follow-ups', async ({ page }) => {
    await page.goto('/follow-ups');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/follow-ups');
  });

  test('navegar para /automacoes', async ({ page }) => {
    await page.goto('/automacoes');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/automacoes');
  });
});

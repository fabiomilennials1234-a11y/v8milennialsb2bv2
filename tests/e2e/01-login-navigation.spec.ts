/**
 * E2E Test 1 — Login and basic navigation
 */

import { test, expect } from '@playwright/test';

test.describe('Login e navegação básica', () => {
  test('fazer login com usuário de teste', async ({ page }) => {
    await page.goto('/login');

    await page.getByPlaceholder(/email/i).fill(process.env.E2E_USER_EMAIL || 'admin@test.com');
    await page.getByPlaceholder(/senha|password/i).fill(process.env.E2E_USER_PASSWORD || 'Test123!@#');
    await page.getByRole('button', { name: /entrar|login|sign in/i }).click();

    await page.waitForURL(/\/(dashboard|leads|follow-ups|$)/, { timeout: 15_000 });
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

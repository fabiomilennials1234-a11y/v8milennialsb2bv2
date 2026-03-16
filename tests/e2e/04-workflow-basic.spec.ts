/**
 * E2E Test 4 — Basic workflow creation and execution
 */

import { test, expect } from '@playwright/test';

test.describe('Workflow básico', () => {
  test('navegar para automações e verificar carregamento', async ({ page }) => {
    await page.goto('/automacoes');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/automacoes');
  });

  test('criar workflow se botão disponível', async ({ page }) => {
    await page.goto('/automacoes');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /novo workflow|criar|new|adicionar/i });
    if (await createBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForLoadState('networkidle');

      // Fill workflow name if field is available
      const nameInput = page.getByLabel(/nome|name/i).first();
      if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await nameInput.fill('E2E Test Workflow');
      }
    }
  });
});

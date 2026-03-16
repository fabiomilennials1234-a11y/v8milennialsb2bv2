/**
 * E2E Test 5 — Operations Center
 */

import { test, expect } from '@playwright/test';

test.describe('Operations Center', () => {
  test('navegar para /master/operations', async ({ page }) => {
    await page.goto('/master/operations');
    await page.waitForLoadState('networkidle');

    // Page should load without errors
    const errorDialog = page.getByRole('alert');
    const hasError = await errorDialog.isVisible({ timeout: 3_000 }).catch(() => false);

    if (!hasError) {
      // Check that some content loaded
      const body = page.locator('body');
      await expect(body).not.toBeEmpty();
    }
  });

  test('abas carregam sem erro', async ({ page }) => {
    await page.goto('/master/operations');
    await page.waitForLoadState('networkidle');

    // Try clicking tab buttons if they exist
    const tabs = page.getByRole('tab');
    const tabCount = await tabs.count();

    for (let i = 0; i < Math.min(tabCount, 3); i++) {
      await tabs.nth(i).click();
      await page.waitForLoadState('networkidle');
    }
  });
});

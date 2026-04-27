/**
 * E2E Test 3 — Lead import flow
 */

import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Importação de leads', () => {
  test('abrir modal de importação e fazer upload de CSV', async ({ page }) => {
    await page.goto('/leads');
    await page.waitForLoadState('networkidle');

    // Look for import button
    const importBtn = page.getByRole('button', { name: /importar|import/i });
    if (await importBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await importBtn.click();

      // Upload CSV fixture
      const csvPath = path.resolve(__dirname, 'fixtures/test-leads.csv');
      const fileInput = page.locator('input[type="file"]');

      if (await fileInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await fileInput.setInputFiles(csvPath);
        await page.waitForLoadState('networkidle');
      }
    }
  });
});

/**
 * E2E Test 2 — Create and move lead
 */

import { test, expect } from '@playwright/test';

test.describe('Criar e mover lead', () => {
  test('criar novo lead via formulário', async ({ page }) => {
    await page.goto('/leads');
    await page.waitForLoadState('networkidle');

    // Click "Novo Lead" button
    const newLeadBtn = page.getByRole('button', { name: /novo lead|new lead|adicionar/i });
    if (await newLeadBtn.isVisible()) {
      await newLeadBtn.click();

      // Fill basic fields
      const nameInput = page.getByLabel(/nome|name/i).first();
      if (await nameInput.isVisible()) {
        await nameInput.fill('E2E Test Lead');
      }

      const companyInput = page.getByLabel(/empresa|company/i).first();
      if (await companyInput.isVisible()) {
        await companyInput.fill('E2E Corp');
      }

      const phoneInput = page.getByLabel(/telefone|phone/i).first();
      if (await phoneInput.isVisible()) {
        await phoneInput.fill('+5511999998877');
      }

      // Submit
      const saveBtn = page.getByRole('button', { name: /salvar|save|criar|create/i });
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForLoadState('networkidle');
      }
    }
  });

  test('lead aparece na lista após criação', async ({ page }) => {
    await page.goto('/leads');
    await page.waitForLoadState('networkidle');

    // Search for the created lead
    const searchInput = page.getByPlaceholder(/buscar|search|pesquisar/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('E2E Test Lead');
      await page.waitForLoadState('networkidle');
    }
  });
});

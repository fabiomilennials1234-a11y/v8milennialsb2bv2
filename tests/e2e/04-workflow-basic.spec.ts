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

  test('node unificado "Enviar Mensagem" no picker, sem labels legados (ADR-0012)', async ({ page }) => {
    await page.goto('/automacoes');
    await page.waitForLoadState('networkidle');

    const createBtn = page.getByRole('button', { name: /novo workflow|criar|new|adicionar/i });
    if (!(await createBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      test.skip(true, 'Botão de criar workflow indisponível neste ambiente');
      return;
    }
    await createBtn.click();
    await page.waitForLoadState('networkidle');

    // Adiciona um nó de ação para revelar o picker de tipo de ação.
    const addActionBtn = page.getByRole('button', { name: /ação|adicionar nó|add node/i }).first();
    if (await addActionBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addActionBtn.click();
    }

    // A entrada unificada existe; os labels legados de envio foram colapsados
    // (somem do picker, conforme ADR-0012).
    await expect(
      page.getByText('Enviar Mensagem', { exact: true }).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Enviar WhatsApp (Texto)')).toHaveCount(0);
    await expect(page.getByText('Enviar WhatsApp (Áudio)')).toHaveCount(0);
  });
});

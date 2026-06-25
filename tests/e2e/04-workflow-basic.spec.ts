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

  test('picker de envio: regime unificado e legado são mutuamente exclusivos (ADR-0012)', async ({ page }) => {
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

    // O node unificado é gateado por org (feature flag unified_message_node).
    // Independente da org: nunca os dois regimes ao mesmo tempo.
    const unifiedCount = await page.getByText('Enviar Mensagem', { exact: true }).count();
    const legacyCount = await page.getByText('Enviar WhatsApp (Texto)').count();
    expect(unifiedCount > 0 && legacyCount > 0).toBeFalsy();
  });
});

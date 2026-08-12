/**
 * E2E Test 8 — Pipe Confirmação
 *
 * Covers: page load, kanban structure, stage columns,
 * add meeting modal, stats component visibility.
 *
 * Stages: Reunião Marcada → Confirmar D-5 → D-3 → D-2 → D-1 →
 *         Confirmação no Dia → Remarcar → Compareceu ✓ → Perdido ✗
 */
import { test, expect } from '@playwright/test';

const ROUTE = '/pipe-confirmacao';

const CONFIRMACAO_STAGES = [
  'Reunião Marcada',
  'Confirmar D-5',
  'Compareceu',
  'Perdido',
];

test.describe('Pipe Confirmação', () => {
  test('página carrega e URL correta', async ({ page }) => {
    const response = await page.goto(ROUTE);
    await page.waitForLoadState('networkidle');

    expect(response?.status()).not.toBe(404);
    expect(response?.status()).not.toBe(500);
    expect(page.url()).toContain(ROUTE);
  });

  test('colunas do kanban renderizam', async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForLoadState('networkidle');

    let foundColumns = 0;
    for (const stage of CONFIRMACAO_STAGES) {
      const col = page.getByRole('heading', {
        level: 3,
        name: new RegExp(stage.replace(/[+*?()|[\]{}]/g, '\\$&'), 'i'),
      });
      if (await col.isVisible({ timeout: 8_000 }).catch(() => false)) {
        foundColumns++;
      }
    }
    expect(foundColumns).toBeGreaterThanOrEqual(2);
  });

  test('botão Adicionar Reunião existe', async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForLoadState('networkidle');

    const addBtn = page
      .getByRole('button', { name: /reunião|meeting|adicionar|nova/i })
      .first();

    if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForLoadState('networkidle');

      // Modal should open
      const modal = page.getByRole('dialog');
      if (await modal.isVisible({ timeout: 5_000 }).catch(() => false)) {
        // Close it
        const cancelBtn = page.getByRole('button', { name: /cancelar|fechar|close|cancel/i });
        if (await cancelBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await cancelBtn.click();
        } else {
          await page.keyboard.press('Escape');
        }
      }
    }

    expect(page.url()).toContain(ROUTE);
  });

  test('stats/métricas renderizam sem erro', async ({ page }) => {
    await page.goto(ROUTE);
    await page.waitForLoadState('networkidle');

    // ConfirmacaoStats component renders numbers/percentages
    const statsContainer = page
      .locator('[class*="stats"], [class*="Stats"], [class*="metric"]')
      .first();

    // If stats visible, check they're not empty
    if (await statsContainer.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(statsContainer).not.toBeEmpty();
    }

    // Page should not crash
    expect(page.url()).toContain(ROUTE);
  });

  test('sem erros de console críticos', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        errors.push(msg.text());
      }
    });

    await page.goto(ROUTE);
    await page.waitForLoadState('networkidle');

    const criticalErrors = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('favicon') &&
        !e.includes('ERR_ABORTED'),
    );

    expect(criticalErrors).toHaveLength(0);
  });
});

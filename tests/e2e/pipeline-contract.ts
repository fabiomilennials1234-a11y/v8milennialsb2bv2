import { test, expect } from '@playwright/test';

/** Legacy links must reach the canonical board with real seeded businesses. */
export function pipelineContract(slug: string, label: string) {
  test.describe(`Funil ${label}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/pipe-${slug}`);
      await expect(page).toHaveURL(new RegExp(`/funil/${slug}(?:[?#]|$)`));
      await expect(page.getByRole('heading', { name: 'Funis', exact: true })).toBeVisible();
    });
    test('link antigo abre o funil correto', async ({ page }) => {
      await expect(page.getByRole('navigation', { name: 'Funis', exact: true })
        .getByRole('button', { name: label, exact: true })).toBeVisible();
      await expect(page.getByRole('tabpanel', { name: 'Kanban', exact: true })).toBeVisible();
    });
    test('etapas e negócio semeado aparecem no board', async ({ page }) => {
      const board = page.getByRole('tabpanel', { name: 'Kanban', exact: true });
      await expect(board.getByRole('heading', { level: 3, name: 'Novo', exact: true })).toBeVisible();
      await expect(board.locator('[data-lead-id]').first()).toBeVisible();
    });
    test('novo negócio abre formulário', async ({ page }) => {
      await page.getByRole('button', { name: 'Novo negócio', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
    test('busca filtra e restaura negócios', async ({ page }) => {
      const board = page.getByRole('tabpanel', { name: 'Kanban', exact: true });
      const search = page.getByRole('textbox', { name: 'Buscar no funil', exact: true });
      await expect(board.locator('[data-lead-id]').first()).toBeVisible();
      await search.fill('E2E_INEXISTENTE_7b2aa6');
      await expect(board.locator('[data-lead-id]')).toHaveCount(0);
      await search.clear();
      await expect(board.locator('[data-lead-id]').first()).toBeVisible();
    });
    test('contagem de negócios disponível', async ({ page }) => {
      await expect(page.getByText(/^Negócios \d/)).toBeVisible();
    });
    test('nenhuma exceção de execução ao recarregar', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.reload();
      await expect(page.getByRole('tabpanel', { name: 'Kanban', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}

import { test, expect } from '@playwright/test';
for (const width of [390, 1024, 1366, 1680]) {
  test(`seleção, identidade e modal sem overflow em ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/clientes-preview.html');
    await expect(page.getByText('Receita no mês', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ver 360 de Norte Sul Alimentos' }).click();
    await expect(page.getByRole('complementary', { name: 'Cliente 360: Norte Sul Alimentos' })).toBeVisible();
    await page.getByRole('button', { name: 'Novo negócio', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Novo negócio · Norte Sul Alimentos' })).toBeVisible();
    if (width < 1024) await expect(page.getByRole('dialog', { name: 'Cliente 360', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    if (width === 1680) await page.getByRole('button', { name: 'Ver 360 de Aurora Distribuidora' }).click();
    if (width === 1680) await page.screenshot({ path: '.specs/assets/clientes-360/implementacao-desktop.png', fullPage: true, animations: 'disabled' });
    if (width === 390) await page.screenshot({ path: '.specs/assets/clientes-360/implementacao-mobile.png', animations: 'disabled' });
  });
}
test('faixa, recompra e busca se combinam; teclado e tema claro', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto('/clientes-preview.html');
  await page.getByRole('combobox', { name: 'Faixa dos clientes' }).click();
  await page.getByRole('option', { name: 'Ouro', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Ver 360 de/ })).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('Atlas');
  await expect(page.getByRole('button', { name: /^Ver 360 de/ })).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: 'Cliente 360: Atlas Embalagens' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Recompra dos clientes' }).click();
  await page.getByRole('option', { name: 'Em atraso', exact: true }).click();
  await expect(page.getByText('Nenhum cliente encontrado')).toBeVisible();
  await page.getByRole('combobox', { name: 'Recompra dos clientes' }).click();
  await page.getByRole('option', { name: 'Recompra', exact: true }).click();
  await page.getByRole('button', { name: 'Ver 360 de Atlas Embalagens' }).focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await expect(page.getByText('Receita no mês', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('inexistente');
  await expect(page.getByText('Nenhum cliente encontrado')).toBeVisible();
});

test('360 completo mostra origem, etapas reais e todas as compras', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.goto('/clientes-preview.html');
  const panel = page.getByRole('complementary', { name: 'Cliente 360: Aurora Distribuidora' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Cliente desde/)).toBeVisible();
  for (const name of ['Contato', 'Proposta', 'Negociação', 'Fechamento']) await expect(panel.getByText(name, { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Ver todas' }).click();
  await expect(page.getByRole('dialog', { name: 'Compras de Aurora Distribuidora' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole('button', { name: /Cliente 360 · Aurora/ }).click();
  await page.getByRole('button', { name: 'Ver todas' }).click();
  await expect(page.getByRole('dialog', { name: 'Compras de Aurora Distribuidora' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Compras de Aurora Distribuidora' })).not.toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Cliente 360', exact: true })).toBeVisible();
});

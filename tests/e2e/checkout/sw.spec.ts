/**
 * Service Worker controlando a página: o defeito que não aparece com `serviceWorkers: 'block'`.
 * `fetch` no SW obedece ao connect-src do /sw.js, sem js.stripe.com. Interceptar era bloquear.
 * Só roda no projeto `sw-allow`.
 */
import { expect, test, type Page } from '@playwright/test';
import { CARD_OK, control, confirmedHeading, fillBuyer, fillCard, pay, shot, stripeInCaches, toCardStep, watchViolations } from './helpers';

test.skip(({ serviceWorkers }) => serviceWorkers !== 'allow', 'precisa de SW de verdade');

test.afterAll(async ({ request }) => {
  await request.post('/__t/cleanup', { timeout: 120_000 });
});

const isControlled = (page: Page) => page.evaluate(() => !!navigator.serviceWorker.controller);
const waitControlled = (page: Page) =>
  page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 30_000 });

test('chegada direta: nenhum SW nasce na tela de pagamento, e paga', async ({ page }) => {
  await control(page, 'sw', { mode: 'current' });
  const violations = watchViolations(page);
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_OK);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await pay(page);
  await expect(confirmedHeading(page)).toBeVisible({ timeout: 60_000 });
  expect(violations).toEqual([]);
});

test('visita prévia a /privacidade com o SW atual, recarga no meio: paga, e Stripe fora do cache', async ({ page }) => {
  await control(page, 'sw', { mode: 'current' });
  const violations = watchViolations(page);
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto('/privacidade');
  await waitControlled(page);

  await page.goto(`/checkout/${token}`);
  expect(await isControlled(page)).toBe(true);
  await fillBuyer(page);
  await toCardStep(page);
  await page.reload();
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_OK);
  await pay(page);
  await expect(confirmedHeading(page)).toBeVisible({ timeout: 60_000 });
  expect(await stripeInCaches(page)).toEqual([]);
  expect(violations).toEqual([]);
});

test('SW antigo instalado e atualização publicada: o cliente paga sem perceber', async ({ page }) => {
  await control(page, 'sw', { mode: 'legacy' });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto('/privacidade');
  await waitControlled(page);

  await control(page, 'sw', { mode: 'current' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_OK);
  await pay(page);
  await expect(confirmedHeading(page)).toBeVisible({ timeout: 60_000 });
  expect(await stripeInCaches(page)).toEqual([]);
});

test('SW antigo sem atualização: o defeito aparece, e quando ela chega "Tentar de novo" recupera sem perder dados', async ({ page }) => {
  await control(page, 'sw', { mode: 'legacy' });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto('/privacidade');
  await waitControlled(page);

  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  await toCardStep(page);
  // Controle positivo: a réplica do SW antigo bloqueia mesmo.
  await expect(page.getByText('O formulário do cartão não carregou.')).toBeVisible({ timeout: 40_000 });

  await control(page, 'sw', { mode: 'current' });
  await page.getByRole('button', { name: 'Tentar de novo' }).click();
  await fillCard(page, CARD_OK);
  await expect(page.getByText('CNPJ terminado em 81')).toBeVisible();
  await pay(page);
  await expect(confirmedHeading(page)).toBeVisible({ timeout: 60_000 });
});

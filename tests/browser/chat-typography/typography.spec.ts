import { test, expect } from '@playwright/test';

test('spaces and numbers keep text metrics when remote fonts are unavailable', async ({ page }) => {
  await page.goto('/tests/browser/chat-typography/index.html');
  await page.evaluate(() => document.fonts.ready);

  const measurements = await page.locator('[data-sample]').evaluateAll((samples) =>
    samples.map((sample) => {
      const key = sample.getAttribute('data-sample');
      const reference = document.querySelector(`[data-reference="${key}"]`)!;
      return {
        key,
        actual: sample.getBoundingClientRect().width,
        expected: reference.getBoundingClientRect().width,
      };
    }),
  );

  for (const { key, actual, expected } of measurements) {
    expect.soft(Math.abs(actual - expected), `${key}: ${actual}px, text reference: ${expected}px`).toBeLessThan(0.5);
  }
  await expect(page.getByRole('textbox', { name: 'Mensagem' })).toHaveValue('Olá! Seu pedido está em andamento.');
  expect(await page.evaluate(() => document.fonts.check('32px "Noto Color Emoji"', '🙂 🫩'))).toBe(true);
});

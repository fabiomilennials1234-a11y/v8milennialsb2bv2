// Run after mock-supabase.mjs and start-vite.mjs. All writes use local fixtures.
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser, prepareContext } from './browser-session.mjs';
import { ROUTES } from './routes.mjs';
import { expect } from '@playwright/test';
const browser = await launchBrowser();
const results = [];
try {
  await mkdir('.ui-shots/emojis', { recursive: true });
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 }, isMobile: width < 500, hasTouch: width < 500 });
    await prepareContext(context, { theme: 'dark', now: Date.parse('2026-09-17T17:30:00Z') });
    const page = await context.newPage();
    const errors = [];
    const consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:4180' + ROUTES.find(route => route.name === 'chat-whatsapp-open').path);
    const trigger = page.getByRole('button', { name: 'Inserir emoji', exact: true }).first();
    await trigger.waitFor({ timeout: 90000 });
    const text = page.getByRole('textbox', { name: /mensagem para/i });
    await text.fill('Bom dia cliente!');
    await text.evaluate(el => el.setSelectionRange(8, 15));
    await trigger.click();
    await page.getByLabel('Buscar emoji', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `.ui-shots/emojis/picker-${width}.png` });
    await page.getByRole('dialog', { name: 'Escolher emoji' }).screenshot({ path: `.ui-shots/emojis/panel-${width}.png` });
    const box = await page.getByRole('dialog', { name: 'Escolher emoji' }).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.getByLabel('Buscar emoji', { exact: true }).fill('pizza');
    await page.getByRole('button', { name: 'pizza', exact: true }).click();
    await expect(text).toHaveValue('Bom dia 🍕!');
    await expect(text).toBeFocused();
    await trigger.click();
    await page.getByRole('button', { name: 'Pessoas e gestos' }).click();
    await page.getByLabel('Tom de pele', { exact: true }).selectOption('3');
    await page.getByRole('button', { name: 'polegar para cima: pele morena', exact: true }).click();
    await expect(text).toHaveValue('Bom dia 🍕👍🏽!');
    expect(errors).toEqual([]);
    results.push({ width, errors, consoleErrors, value: await text.inputValue(), bounds: box });
    await context.close();
  }
  await writeFile('.ui-shots/emojis/report.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }

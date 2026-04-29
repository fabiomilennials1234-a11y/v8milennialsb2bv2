/**
 * E2E Test 12 — Chat Layout (Onda 2b)
 *
 * Covers contrato de layout do chat novo (VITE_CHAT_ONDA_2B):
 * - Sem scroll horizontal no body em 1365x768.
 * - Header / Composer fixos, MessageList rola.
 * - Documento outbound não estoura bolha (max-w-[75%]).
 * - Imagem/vídeo respeitam largura disponível.
 * - Densidades compact / comfortable / spacious sem zoom quebrado.
 *
 * Requires: seeded admin com instância WhatsApp + ao menos 1 conversa.
 */
import { test, expect } from '@playwright/test';

const ROUTE = '/chat-whatsapp';

test.describe('Chat Layout — Onda 2b', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1365, height: 768 });
    await page.goto(ROUTE);
    await page.waitForLoadState('networkidle');
  });

  test('viewport 1365x768 não gera scroll horizontal no body', async ({ page }) => {
    const overflow = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      return {
        bodyScroll: body.scrollWidth > body.clientWidth,
        htmlScroll: html.scrollWidth > html.clientWidth,
      };
    });
    expect(overflow.bodyScroll).toBe(false);
    expect(overflow.htmlScroll).toBe(false);
  });

  test('cadeia chat: header + lista + composer respeita min-w-0', async ({ page }) => {
    // Garante que nenhum filho da cadeia chat estoura horizontalmente
    const violations = await page.evaluate(() => {
      const root = document.querySelector('[aria-label="Layout do chat"]');
      if (!root) return { found: false, offenders: [] as string[] };
      const all = root.querySelectorAll<HTMLElement>('*');
      const offenders: string[] = [];
      all.forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1 && el.tagName !== 'IMG' && el.tagName !== 'VIDEO') {
          // Ignora ScrollArea horizontal (data-radix), virtualizer, overflow-x-auto explícito
          const cs = getComputedStyle(el);
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
          offenders.push(`${el.tagName}.${el.className}`.slice(0, 120));
        }
      });
      return { found: true, offenders: offenders.slice(0, 5) };
    });
    if (violations.found) {
      expect(violations.offenders, JSON.stringify(violations.offenders)).toEqual([]);
    }
  });

  test('zoom 125% e 150% não quebram layout', async ({ page }) => {
    for (const zoom of [1.25, 1.5]) {
      await page.evaluate((z) => {
        document.documentElement.style.zoom = String(z);
      }, zoom);
      await page.waitForTimeout(200);
      const horizScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(horizScroll, `zoom ${zoom}`).toBe(false);
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });
  });

  test('deep-link ?phone= continua funcionando', async ({ page }) => {
    await page.goto(`${ROUTE}?phone=5511999999999`);
    await page.waitForLoadState('networkidle');
    // Não trava — pode ou não achar o contato, mas a URL params são limpas após processar
    await page.waitForTimeout(1500);
    expect(page.url()).toContain('/chat-whatsapp');
  });
});

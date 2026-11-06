/**
 * Checkout do link de pagamento, de ponta a ponta: build real, headers reais, handlers reais
 * sobre PGlite e Stripe em modo teste. Como rodar: `playwright.checkout.config.ts`.
 *
 * Nada aqui imprime token ou client_secret: as asserções usam `.toBe(true)` sobre o resultado
 * da comparação, nunca o valor, porque o diff do Playwright imprimiria o objeto.
 */
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUYER, CARD_3DS, CARD_DECLINE, CARD_OK, DIAGNOSTICS, SHOTS, confirmedHeading, control, elementFrame, externalNotes,
  fillBuyer, fillCard, pay, replayRecordings, shot, toCardStep, watchViolations, whereInDom,
} from './helpers';

test.afterAll(async ({ request }) => {
  await request.post('/__t/cleanup', { timeout: 120_000 });
  DIAGNOSTICS.avisos_de_terceiros = [...externalNotes];
  // Falha reinicia o worker: junta com o que outra rodada já escreveu.
  const file = join(SHOTS, 'diagnostics.json');
  const previous = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(file, JSON.stringify({ ...previous, ...DIAGNOSTICS }, null, 2));
});

test('4242 até confirmado: org ativa, validade = current_period_end, nada de segredo no DOM', async ({ page }) => {
  const violations = watchViolations(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'semiannual' });
  await page.goto(`/checkout/${token}`);

  await expect(page.getByRole('heading', { level: 1, name: BUYER.name })).toBeVisible();
  await expect(page.getByText('Copilot', { exact: true })).toBeVisible();
  expect(await page.title()).toBe('Pagamento | Torque CRM');
  await shot(page, 'desktop-1-comprador');

  // Sem marcar a autorização não há POST.
  await fillBuyer(page, { consent: false });
  let posts = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/billing-checkout-subscription')) posts += 1;
  });
  await page.getByRole('button', { name: 'Continuar para o cartão' }).click();
  await expect(page.getByText('Marque a autorização para continuar.')).toBeVisible();
  await expect(page.getByRole('checkbox')).toBeFocused();
  expect(posts).toBe(0);
  await shot(page, 'desktop-2-erro-autorizacao');
  await page.getByRole('checkbox').check();

  const secret = await toCardStep(page);
  await elementFrame(page);
  await expect(page.getByText('CNPJ terminado em 81')).toBeVisible();

  const body = await page.evaluate(() => document.body.innerHTML);
  expect(body.includes(BUYER.docDigits)).toBe(false);
  expect(body.includes(BUYER.doc)).toBe(false);
  // O secret não aparece. O token só no fragmento dos iframes que o Stripe.js monta (é a URL da
  // página que ele guarda), que não viaja na rede e é de outra origem. Nada escrito por nós.
  const tokenHits = await whereInDom(page, token);
  DIAGNOSTICS.token_no_dom = tokenHits;
  expect(tokenHits.every((h) => h === 'iframe[src]#fragmento js.stripe.com')).toBe(true);
  expect((await whereInDom(page, secret)).length).toBe(0);

  await fillCard(page, CARD_OK);
  await shot(page, 'desktop-3-cartao');
  await pay(page);
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toBeFocused();
  await expect(page.getByText('Pago hoje')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Estamos registrando' })).toBeVisible();
  await shot(page, 'desktop-4-confirmado');

  const after = await control<{ org_status: string; org_expires_at: string; period_end: number; paid: boolean; history: number; stripe_subscriptions: number }>(page, 'pump', { token });
  expect(after.paid).toBe(true);
  expect(after.org_status).toBe('active');
  expect(new Date(after.org_expires_at).getTime()).toBe(after.period_end * 1000);
  expect(after.history).toBe(1);
  expect(after.stripe_subscriptions).toBe(1);

  await expect(page.getByRole('status').filter({ hasText: 'Assinatura registrada' })).toBeVisible({ timeout: 30_000 });

  // Storage: só a marca, sem token nem PII.
  const storage = await page.evaluate(() => JSON.stringify({ s: { ...sessionStorage }, l: { ...localStorage } }));
  expect(storage.includes(token)).toBe(false);
  expect(storage.includes(BUYER.docDigits)).toBe(false);
  expect(storage.includes(secret)).toBe(false);
  expect(storage).toMatch(/torque-checkout-paid:[0-9a-f]{8}/);

  // Depois de pago, recarregar leva ao terminal de já pago.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Este link já foi pago' })).toBeVisible();
  expect(violations).toEqual([]);
});

test('recarregar depois do succeeded e antes do webhook: confirmado, sem formulário', async ({ page }) => {
  const violations = watchViolations(page);
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_OK);
  await pay(page);
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar para o cartão' })).toHaveCount(0);
  expect(violations).toEqual([]);
});

test('recusa e novo cartão no mesmo fluxo, sem segunda assinatura', async ({ page }) => {
  const violations = watchViolations(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'annual' });
  const declineShape: unknown[] = [];
  page.on('response', async (r) => {
    if (/payment_intents\/[^/]+\/confirm/.test(r.url()) && r.status() === 402) {
      const j = (await r.json().catch(() => ({}))) as { error?: { type?: string; code?: string; decline_code?: string } };
      declineShape.push({ type: j.error?.type, code: j.error?.code, decline_code: j.error?.decline_code });
    }
  });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_DECLINE);
  await pay(page);
  await expect(page.getByRole('alert')).toContainText('Nada foi cobrado', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /^Pagar / })).toBeVisible();
  await shot(page, 'desktop-5-recusado');
  DIAGNOSTICS.recusa_formato = declineShape;

  await fillCard(page, CARD_OK);
  await pay(page);
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toBeVisible({ timeout: 60_000 });
  const after = await control<{ org_status: string; stripe_subscriptions: number; attempt: number; paid: boolean }>(page, 'pump', { token });
  expect(after.org_status).toBe('active');
  expect(after.stripe_subscriptions).toBe(1);
  expect(after.attempt).toBe(1);
  expect(violations).toEqual([]);
});

/** O desafio de teste da Stripe mora em iframe dentro de iframe e os ids mudam: acha pelo rótulo. */
async function clickChallenge(page: Page, name: 'Fail' | 'Complete') {
  for (let i = 0; i < 60; i++) {
    for (const frame of page.frames()) {
      const button = frame.getByRole('button', { name, exact: true });
      if ((await button.count().catch(() => 0)) && (await button.first().isVisible().catch(() => false))) {
        await page.waitForTimeout(800); // o diálogo ainda está entrando
        if (name === 'Fail') await shot(page, 'desktop-6-3ds', false);
        await button.first().click();
        return;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('desafio 3DS não apareceu');
}

test('3DS 4000002760003184: falha, novo intento e conclusão; CSP e payment=() não atrapalham', async ({ page }) => {
  const violations = watchViolations(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  const response = await page.goto(`/checkout/${token}`);
  expect(response?.headers()['permissions-policy']).toContain('payment=()');
  expect(response?.headers()['content-security-policy']).toContain("form-action 'self'");
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_3DS);
  await pay(page);
  await clickChallenge(page, 'Fail');
  await expect(page.getByRole('alert')).toContainText('confirmação no banco não foi concluída', { timeout: 60_000 });

  await pay(page);
  await clickChallenge(page, 'Complete');
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toBeVisible({ timeout: 60_000 });
  const after = await control<{ org_status: string }>(page, 'pump', { token });
  expect(after.org_status).toBe('active');
  expect(violations).toEqual([]);
});

test('recarga reusa o mesmo client_secret, sem nova assinatura; volta de redirect limpa a URL', async ({ page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  const first = await toCardStep(page);
  await page.reload();
  await expect(page.getByLabel('CNPJ ou CPF')).toHaveValue('');
  await fillBuyer(page);
  const second = await toCardStep(page);
  expect(first === second).toBe(true);
  const state = await control<{ attempt: number; stripe_subscriptions: number }>(page, 'state', { token });
  expect(state.attempt).toBe(1);
  expect(state.stripe_subscriptions).toBe(1);

  const pi = first.split('_secret_')[0];
  await page.goto(`/checkout/${token}?payment_intent=${pi}&payment_intent_client_secret=${first}&redirect_status=failed`);
  await expect(page.getByLabel('CNPJ ou CPF')).toBeVisible();
  expect(page.url().includes('secret')).toBe(false);
  expect(page.url().includes('payment_intent')).toBe(false);
  await expect(page.getByRole('alert')).toContainText(/nada foi cobrado/i);
});

test('link inválido, sem token, vencido, revogado e já pago', async ({ page }) => {
  const expired = await control<{ token: string }>(page, 'seed', { expiresAt: new Date(Date.now() - 86_400_000).toISOString() });
  const revoked = await control<{ token: string }>(page, 'seed', { revoked: true });
  const paid = await control<{ token: string }>(page, 'seed', { paid: true });
  const cases: [string, string, string][] = [
    ['/checkout/tq_pay_nao_existe', 'Não encontramos este link', 'nao-encontrado'],
    ['/checkout', 'Não encontramos este link', 'sem-token'],
    [`/checkout/${expired.token}`, 'Esta proposta venceu', 'vencida'],
    [`/checkout/${revoked.token}`, 'Este link foi cancelado', 'revogado'],
    [`/checkout/${paid.token}`, 'Este link já foi pago', 'ja-pago'],
  ];
  for (const [path, title, name] of cases) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Continuar para o cartão' })).toHaveCount(0);
    await shot(page, `terminal-${name}-desktop`);
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, `terminal-${name}-mobile`);
  }
  await expect(page.getByRole('link', { name: 'Entrar no Torque' })).toHaveAttribute('href', '/auth');
});

test.describe('falhas da rede e do contrato', () => {
  const fulfill = (page: Page, fn: string, status: number, json: unknown) =>
    page.route(`**/functions/v1/${fn}`, (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) }));

  test('link: 429, 500 e rede caída têm tela própria e ação', async ({ page }) => {
    await fulfill(page, 'billing-payment-link', 429, { error: 'rate_limited' });
    await page.goto('/checkout/tq_pay_x');
    await expect(page.getByRole('heading', { name: 'Muitas tentativas em pouco tempo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeDisabled();
    await shot(page, 'terminal-429');

    await page.unroute('**/functions/v1/billing-payment-link');
    await fulfill(page, 'billing-payment-link', 500, { error: 'internal_error' });
    await page.goto('/checkout/tq_pay_x');
    await expect(page.getByRole('heading', { name: 'Pagamento indisponível no momento' })).toBeVisible();
    await shot(page, 'terminal-indisponivel');

    await page.unroute('**/functions/v1/billing-payment-link');
    await page.route('**/functions/v1/billing-payment-link', (route) => route.abort());
    await page.goto('/checkout/tq_pay_x');
    await expect(page.getByText('Não conseguimos conectar.')).toBeVisible();

    await page.unroute('**/functions/v1/billing-payment-link');
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.getByRole('heading', { name: 'Não encontramos este link' })).toBeVisible();
  });

  for (const [label, patch] of [['valor', { amount_cents: 100 }], ['livemode', { livemode: true }]] as const) {
    test(`trava de ${label}: resposta divergente não monta Elements`, async ({ page }) => {
      const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
      await page.goto(`/checkout/${token}`);
      await page.route('**/functions/v1/billing-checkout-subscription', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({ response, json: { ...body, ...patch } });
      });
      await fillBuyer(page);
      await page.getByRole('button', { name: 'Continuar para o cartão' }).click();
      await expect(page.getByRole('heading', { name: 'Pagamento indisponível no momento' })).toBeVisible();
      await expect(page.locator('#checkout-payment-element')).toHaveCount(0);
    });
  }

  test('POST: consent_required e 503', async ({ page }) => {
    const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
    await page.goto(`/checkout/${token}`);
    await fulfill(page, 'billing-checkout-subscription', 200, { state: 'consent_required', consent_version: '2030-01-01' });
    await fillBuyer(page);
    await page.getByRole('button', { name: 'Continuar para o cartão' }).click();
    await expect(page.getByRole('heading', { name: 'Esta página foi atualizada' })).toBeVisible();
    await shot(page, 'terminal-bundle-defasado');

    await page.unroute('**/functions/v1/billing-checkout-subscription');
    await page.goto(`/checkout/${token}`);
    await fulfill(page, 'billing-checkout-subscription', 503, { state: 'billing_not_configured' });
    await fillBuyer(page);
    await page.getByRole('button', { name: 'Continuar para o cartão' }).click();
    await expect(page.getByRole('heading', { name: 'Pagamento indisponível no momento' })).toBeVisible();
  });

  test('Stripe.js bloqueado: avisa na etapa 2 e "Tentar de novo" recupera', async ({ page }) => {
    const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
    await page.route('https://js.stripe.com/**', (route) => route.abort());
    await page.goto(`/checkout/${token}`);
    await fillBuyer(page);
    await toCardStep(page);
    await expect(page.getByText('O formulário do cartão não carregou.')).toBeVisible();
    await shot(page, 'desktop-7-stripe-bloqueado');
    await page.unroute('https://js.stripe.com/**');
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await expect(page.locator('#checkout-payment-element iframe').first()).toBeVisible({ timeout: 60_000 });
  });
});

test('sistema em tema claro: página escura desde o início, sem abertura, v8-theme intacto', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('v8-theme', 'light');
    const samples: { dark: boolean; bg: string }[] = [];
    (window as unknown as { __samples: typeof samples }).__samples = samples;
    const tick = () => {
      if (document.body) {
        samples.push({ dark: document.documentElement.classList.contains('dark'), bg: getComputedStyle(document.body).backgroundColor });
      }
      if (samples.length < 240) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const { token } = await control<{ token: string }>(page, 'seed', {});
  await page.goto(`/checkout/${token}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const samples = await page.evaluate(() => (window as unknown as { __samples: { dark: boolean; bg: string }[] }).__samples);
  const light = samples.filter((s) => !s.dark || /rgb\((2[0-9]{2}), (2[0-9]{2})/.test(s.bg));
  DIAGNOSTICS.clarao = { amostras: samples.length, claras: light.length, cores: [...new Set(samples.map((s) => s.bg))] };
  expect(light.length).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('v8-theme'))).toBe('light');
  // Com a abertura tocando, o centro da tela seria dela, e não do formulário.
  const onTop = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!el?.closest('aside, main');
  });
  expect(onTop).toBe(true);
});

test('logado: suporte e palette não sobem no pagamento', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.addInitScript(() => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '00000000-0000-4000-8000-000000000001', exp, role: 'authenticated', aud: 'authenticated', email: 'admin@example.com' })}.x`;
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: access, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
      user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'admin@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
    }));
  });
  let rest = 0;
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/')) rest += 1;
  });
  await page.goto(`/checkout/${token}`);
  await expect(page.getByRole('button', { name: 'Continuar para o cartão' })).toBeVisible();
  await page.waitForTimeout(2500);
  DIAGNOSTICS.logado_chamadas_rest = rest;
  expect(rest).toBeGreaterThan(0); // controle positivo: o app acreditou na sessão
  await page.keyboard.press('Meta+k');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar para o cartão' }).click({ trial: true, timeout: 5_000 });
  await shot(page, 'desktop-8-logado', false);
});

test('mobile 390 e 320: sem rolagem lateral, valor e recorrência à vista, confirmado primeiro', async ({ page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'semiannual' });
  const noOverflow = () => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/checkout/${token}`);
  await expect(page.getByText('à vista no cartão, hoje.', { exact: false })).toBeVisible();
  await expect(page.getByText(/Renova automaticamente a cada 6 meses/)).toBeVisible();
  await expect(page.getByText('Copilot', { exact: true })).toBeHidden();
  await noOverflow();
  await shot(page, 'mobile-1-comprador');
  await page.getByRole('button', { name: 'Ver detalhes da proposta' }).click();
  await expect(page.getByText('Copilot', { exact: true })).toBeVisible();
  await shot(page, 'mobile-2-detalhes');
  await page.getByRole('button', { name: 'Ocultar detalhes' }).click();

  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_OK);
  await noOverflow();
  await shot(page, 'mobile-3-cartao');
  await pay(page);
  await expect(page.getByRole('heading', { name: 'Pagamento confirmado' })).toBeVisible({ timeout: 60_000 });
  const first = await page.evaluate(() => {
    const main = document.querySelector('main')!.getBoundingClientRect();
    const aside = document.querySelector('aside')!.getBoundingClientRect();
    return main.top < aside.top;
  });
  expect(first).toBe(true);
  await shot(page, 'mobile-4-confirmado');

  // O maior valor do catálogo em 320 px, com o nome mais comprido que a tela suporta.
  const big = await control<{ token: string }>(page, 'seed', { cycle: 'annual', name: 'Metalúrgica e Distribuidora Andrade & Filhos Indústria e Comércio Ltda' });
  await page.route('**/functions/v1/billing-payment-link', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.link.amount_cents = 12294000;
    await route.fulfill({ response, json: body });
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/checkout/${big.token}`);
  await expect(page.locator('p[aria-label="R$ 122.940,00"]')).toBeVisible();
  await noOverflow();
  await shot(page, 'mobile-5-320-maior-valor');
});

test('paridade e contraste medidos na tela, incluindo dentro do iframe da Stripe', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await expect(page.getByRole('button', { name: 'Continuar para o cartão' })).toBeVisible();

  const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
  /** Borda com alfa: compõe sobre o fundo do campo antes de medir. */
  const over = (c: string, bg: string) => {
    const [r, g, b, a = 1] = parse(c);
    const [br, bg2, bb] = parse(bg);
    return `rgb(${r! * a + br! * (1 - a)}, ${g! * a + bg2! * (1 - a)}, ${b! * a + bb! * (1 - a)})`;
  };
  const lum = (rgb: number[]) => {
    const l = rgb.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p);
    return Number(((x! + 0.05) / (y! + 0.05)).toFixed(2));
  };
  const pageColors = await page.evaluate(() => {
    const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!);
    return {
      aside: cs('aside').backgroundColor === 'rgba(0, 0, 0, 0)' ? getComputedStyle(document.body).backgroundColor : cs('aside').backgroundColor,
      main: cs('main').backgroundColor,
      h1: cs('h1').color,
      caption: cs('aside p.text-muted-foreground').color,
      label: cs('label[for="checkout-legal-name"]').color,
      inputBg: cs('#checkout-legal-name').backgroundColor,
      inputBorder: cs('#checkout-legal-name').borderTopColor,
      inputText: cs('#checkout-legal-name').color,
      inputHeight: document.querySelector('#checkout-legal-name')!.getBoundingClientRect().height,
      inputRadius: cs('#checkout-legal-name').borderTopLeftRadius,
      cta: cs('button[type="submit"]').backgroundColor,
      ctaText: cs('button[type="submit"]').color,
      animation: cs('form').animationName,
    };
  });
  await fillBuyer(page);
  await toCardStep(page);
  const frame = await elementFrame(page);
  await frame.locator('input[name="number"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const stripe = await frame.evaluate(() => {
    const input = document.querySelector('input[name="number"]') as HTMLInputElement;
    const s = getComputedStyle(input);
    const box = input.closest('.Input') ?? input;
    const b = getComputedStyle(box);
    const label = getComputedStyle(document.querySelector('label')!);
    const fonts = Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family);
    return {
      text: s.color, bg: b.backgroundColor, border: b.borderTopColor, height: box.getBoundingClientRect().height,
      radius: b.borderTopLeftRadius, family: s.fontFamily, label: label.color, labelText: document.querySelector('label')!.textContent, fontsLoaded: [...new Set(fonts)],
      lang: document.documentElement.lang,
    };
  });
  const stripeBadgeOverCta = await page.getByRole('button', { name: /^Pagar / }).click({ trial: true, timeout: 5_000 }).then(() => false, () => true);
  await frame.locator('input[name="number"]').focus();
  const pairs = {
    'h1/aside': ratio(pageColors.h1, pageColors.aside),
    'legenda/aside': ratio(pageColors.caption, pageColors.aside),
    'label/main': ratio(pageColors.label, pageColors.main),
    'texto input/input': ratio(pageColors.inputText, pageColors.inputBg),
    'borda input/main': ratio(over(pageColors.inputBorder, pageColors.inputBg), pageColors.main),
    'CTA texto/CTA': ratio(pageColors.ctaText, pageColors.cta),
    'stripe texto/stripe input': ratio(stripe.text, stripe.bg),
    'stripe borda/main': ratio(stripe.border, pageColors.main),
    'stripe label/main': ratio(stripe.label, pageColors.main),
  };
  DIAGNOSTICS.contraste = pairs;
  DIAGNOSTICS.paridade = { nosso: { altura: pageColors.inputHeight, raio: pageColors.inputRadius }, stripe: { altura: stripe.height, raio: stripe.radius, familia: stripe.family, fontes: stripe.fontsLoaded, rotulo: stripe.labelText, lang: stripe.lang }, stripeBadgeOverCta };
  for (const [k, v] of Object.entries(pairs)) expect(v, k).toBeGreaterThanOrEqual(k.includes('borda') ? 3 : 4.5);
  expect(Math.abs(stripe.height - pageColors.inputHeight)).toBeLessThanOrEqual(1);
  expect(stripe.radius).toBe(pageColors.inputRadius);
  expect(stripe.labelText).toBe('Número do cartão'); // locale pt-BR
});

test('largura de notebook pequeno: CTA da etapa 1 à vista em 1024x768 com rolagem curta', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'semiannual' });
  await page.goto(`/checkout/${token}`);
  await expect(page.getByRole('button', { name: 'Continuar para o cartão' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await shot(page, 'desktop-9-1024');
});

test('prefers-reduced-motion: sem animação de entrada na etapa', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await expect(page.getByRole('button', { name: 'Continuar para o cartão' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('form')!).animationName)).toBe('none');
  await context.close();
});

test('Sentry: nem token, nem client_secret, nem documento, nem e-mail chegam ao relatório', async ({ page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  const secret = await toCardStep(page);
  const before = (await control<{ envelopes: string[] }>(page, 'sentry')).envelopes.length;
  // Erro lançado de propósito carregando tudo o que não pode sair, inclusive pela URL corrente.
  await page.evaluate(([t, s, d, e]) => {
    setTimeout(() => {
      throw new Error(`falha ao falar com https://x.example/checkout/${t}?payment_intent_client_secret=${s} tq ${t} ${s} doc ${d} e-mail ${e}`);
    }, 0);
  }, [token, secret, BUYER.docDigits, BUYER.email]);
  await expect.poll(async () => (await control<{ envelopes: string[] }>(page, 'sentry')).envelopes.length, { timeout: 30_000 }).toBeGreaterThan(before);
  const { envelopes } = await control<{ envelopes: string[] }>(page, 'sentry');
  const all = envelopes.join('\n');
  expect(all.includes(token)).toBe(false);
  expect(all.includes(secret)).toBe(false);
  expect(all.includes(BUYER.docDigits)).toBe(false);
  expect(all.includes(BUYER.email)).toBe(false);
  expect(all.includes('/checkout/:token')).toBe(true); // controle positivo: a URL chegou, parametrizada
  DIAGNOSTICS.sentry_envelopes = envelopes.length;
});

test('build: sem segredo no bundle e Stripe.js só no chunk da rota', async ({ page }) => {
  const dist = process.env.CHECKOUT_E2E_DIST as string;
  expect(existsSync(dist)).toBe(true);
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const files = walk(dist).filter((f) => /\.(js|css|html|json|webmanifest|map)$/.test(f));
  const secretHits = files.filter((f) => /(sk|rk)_(test|live)_[A-Za-z0-9]{8}|whsec_[A-Za-z0-9]{8}/.test(readFileSync(f, 'latin1')));
  expect(secretHits).toEqual([]);

  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entry = /src="\/?(assets\/[^"]+\.js)"/.exec(html)?.[1] as string;
  expect(readFileSync(join(dist, entry), 'latin1').includes('js.stripe.com/')).toBe(false);

  let stripeCalls = 0;
  page.on('request', (r) => {
    if (r.url().includes('stripe.com')) stripeCalls += 1;
  });
  await page.goto('/privacidade');
  await page.waitForLoadState('networkidle');
  expect(stripeCalls).toBe(0);
});

test('Sentry: replay não grava na chegada direta; o erro é reportado mesmo assim, sem vídeo', async ({ page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  const before = (await control<{ envelopes: string[] }>(page, 'sentry')).envelopes.length;
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  const secret = await toCardStep(page);
  await page.waitForTimeout(4000); // tempo do whenIdle que carregaria o replay
  await page.evaluate((t) => {
    setTimeout(() => { throw new Error(`qa_boom_direto https://x.example/checkout/${t}`); }, 0);
  }, token);
  await expect.poll(async () => (await control<{ envelopes: string[] }>(page, 'sentry')).envelopes.slice(before).join('').includes('qa_boom_direto'), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(7000); // dá tempo de um flush de replay, se houvesse
  const novos = (await control<{ envelopes: string[] }>(page, 'sentry')).envelopes.slice(before);
  const all = novos.join('\n');
  expect(all.includes('"replay_recording"')).toBe(false);
  expect(all.includes('"replay_event"')).toBe(false);
  expect(all.includes(token)).toBe(false);
  expect(all.includes(secret)).toBe(false);
  expect(all.includes('/checkout/:token')).toBe(true);
  DIAGNOSTICS.replay_chegada_direta = { envelopes: novos.length, gravacoes: replayRecordings(novos).length };
});

/** Lê do cliente do Sentry, no navegador, se a gravação está ligada. */
const replayEnabled = () => {
  const carrier = (window as unknown as { __SENTRY__?: Record<string, { defaultCurrentScope?: { getClient?: () => { getIntegrationByName?: (n: string) => { _replay?: { isEnabled?: () => boolean } } | undefined } | undefined } }> & { version?: string } }).__SENTRY__;
  const scope = carrier?.[carrier.version as string]?.defaultCurrentScope;
  return scope?.getClient?.()?.getIntegrationByName?.('Replay')?._replay?.isEnabled?.() === true;
};

test('Sentry: quem chega navegando de outra rota não leva o token na gravação', async ({ page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  const before = (await control<{ envelopes: string[] }>(page, 'sentry')).envelopes.length;
  await page.goto('/privacidade');
  // Sem isto o teste passaria com o replay nem ligado: "0 gravações" não provaria nada.
  await page.waitForFunction(replayEnabled, undefined, { timeout: 30_000 });
  await page.evaluate((t) => {
    window.history.pushState({}, '', `/checkout/${t}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, token);
  await expect(page.getByRole('button', { name: 'Continuar para o cartão' })).toBeVisible();
  expect(await page.evaluate(replayEnabled)).toBe(false); // parou ao entrar
  await fillBuyer(page);
  await toCardStep(page);
  await page.waitForTimeout(1500);
  await page.evaluate((t) => {
    setTimeout(() => { throw new Error(`qa_boom_nav https://x.example/checkout/${t}`); }, 0);
  }, token);
  await expect.poll(async () => (await control<{ envelopes: string[] }>(page, 'sentry')).envelopes.slice(before).join('').includes('qa_boom_nav'), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(8000);
  await page.evaluate(() => { window.dispatchEvent(new Event('beforeunload')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(6000);
  const novos = (await control<{ envelopes: string[] }>(page, 'sentry')).envelopes.slice(before);
  const gravacoes = replayRecordings(novos);
  const tudo = `${novos.join('\n')}\n${gravacoes.join('\n')}`;
  expect(tudo.includes(token)).toBe(false);
  expect(tudo.includes('/checkout/:token')).toBe(true);
  DIAGNOSTICS.replay_navegando = { envelopes: novos.length, gravacoes: gravacoes.length, bytes: gravacoes.join('').length };
});

test('C: resposta do confirm perdida com o pagamento feito: mostra confirmado, nunca "Nada foi cobrado"', async ({ page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_OK);
  await page.route(/payment_intents\/[^/]+\/confirm/, async (route) => {
    await route.fetch();
    await route.abort();
  });
  await pay(page);
  await expect(confirmedHeading(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Nada foi cobrado')).toHaveCount(0);
  const after = await control<{ paid: boolean; org_status: string }>(page, 'pump', { token });
  expect(after.org_status).toBe('active');
});

test('C: rede caída antes de enviar: não afirma nada, e tentar de novo cobra uma vez só', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_OK);
  await page.route(/payment_intents\/[^/]+/, (route) => route.abort());
  await pay(page);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Não foi possível confirmar o pagamento', { timeout: 90_000 });
  await expect(alert).toContainText('não cobra duas vezes');
  await expect(page.getByText('recusou')).toHaveCount(0);
  await expect(page.getByText('Nada foi cobrado')).toHaveCount(0);
  await shot(page, 'desktop-10-nao-confirmado');
  await page.unroute(/payment_intents\/[^/]+/);
  await pay(page);
  await expect(confirmedHeading(page)).toBeVisible({ timeout: 60_000 });
  const after = await control<{ paid_invoices: number; stripe_subscriptions: number }>(page, 'pump', { token });
  expect(after.stripe_subscriptions).toBe(1);
  expect(after.paid_invoices).toBe(1);
});

test('Q4: Alterar e pagar: a fatura sai com o comprador corrigido; aba com secret velho não paga', async ({ browser, baseURL, page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  const antigo = await toCardStep(page);

  // Segunda aba, ainda com a etapa do cartão aberta no secret antigo.
  const outra = await (await browser.newContext({ baseURL, serviceWorkers: 'block', locale: 'pt-BR' })).newPage();
  await outra.goto(`/checkout/${token}`);
  await fillBuyer(outra);
  expect((await toCardStep(outra)) === antigo).toBe(true);
  await fillCard(outra, CARD_OK);

  await page.getByRole('button', { name: 'Alterar' }).click();
  await page.getByLabel('Razão social ou nome').fill('Riofix Corrigida Ltda');
  await page.getByLabel('CNPJ ou CPF').fill('11.444.777/0001-61');
  await page.getByLabel('E-mail').fill('corrigido@riofix.example.com');
  const novo = await toCardStep(page);
  expect(novo === antigo).toBe(false);

  // A aba velha tenta pagar: a fatura foi anulada, e a tela não celebra nem cobra.
  await pay(outra);
  await expect(outra.getByText('A sessão de pagamento expirou e nada foi cobrado.')).toBeVisible({ timeout: 60_000 });
  await outra.context().close();

  await fillCard(page, CARD_OK);
  await pay(page);
  await expect(confirmedHeading(page)).toBeVisible({ timeout: 60_000 });
  const after = await control<{ attempt: number; paid_invoices: number; active_subscriptions: number; invoice_name: string; invoice_email: string; invoice_tax_ids: string[]; org_status: string }>(page, 'pump', { token });
  expect(after.attempt).toBe(2);
  expect(after.paid_invoices).toBe(1);
  expect(after.active_subscriptions).toBe(1);
  expect(after.invoice_name).toBe('Riofix Corrigida Ltda');
  expect(after.invoice_email).toBe('corrigido@riofix.example.com');
  expect(after.invoice_tax_ids).toEqual(['11.444.777/0001-61']);
  expect(after.org_status).toBe('active');
});

test('Q5: Alterar fica travado enquanto processa', async ({ page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  await toCardStep(page);
  await fillCard(page, CARD_3DS);
  await pay(page);
  await expect(page.getByRole('button', { name: /Processando pagamento/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Alterar' })).toBeDisabled();
});

test('Q7: /checkout/%00 é "não encontramos", sem 500', async ({ page }) => {
  const statuses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/functions/v1/')) statuses.push(r.status());
  });
  await page.goto('/checkout/%00');
  await expect(page.getByRole('heading', { name: 'Não encontramos este link' })).toBeVisible();
  expect(statuses.filter((s) => s >= 500)).toEqual([]);
  const direto = await page.request.post('/functions/v1/billing-payment-link', { data: { token: '\u0000' } });
  expect(direto.status()).toBe(200);
  expect(((await direto.json()) as { state: string }).state).toBe('not_found');
});

test('volta do banco com Stripe.js bloqueado e pagamento feito: não afirma nada, e tentar de novo confirma', async ({ browser, baseURL, page }) => {
  const { token } = await control<{ token: string }>(page, 'seed', { cycle: 'monthly' });
  await page.goto(`/checkout/${token}`);
  await fillBuyer(page);
  const secret = await toCardStep(page);
  await fillCard(page, CARD_OK);
  await pay(page);
  await expect(confirmedHeading(page)).toBeVisible({ timeout: 60_000 });

  // Outro navegador, sem a marca de pago. Webhook ainda não chegou: o link segue válido.
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block', locale: 'pt-BR', viewport: { width: 1440, height: 900 } });
  const other = await context.newPage();
  await other.route('https://js.stripe.com/**', (route) => route.abort());
  const pi = secret.split('_secret_')[0];
  await other.goto(`/checkout/${token}?payment_intent=${pi}&payment_intent_client_secret=${secret}&redirect_status=succeeded`);
  await expect(other.getByRole('heading', { name: 'Não conseguimos confirmar o pagamento' })).toBeVisible({ timeout: 30_000 });
  expect(await other.evaluate(() => /nada foi cobrado/i.test(document.body.innerText))).toBe(false);
  expect(other.url().includes('secret')).toBe(false);
  await shot(other, 'terminal-volta-nao-confirmada');

  await other.unroute('https://js.stripe.com/**');
  await other.getByRole('button', { name: 'Tentar de novo' }).click();
  await expect(confirmedHeading(other)).toBeVisible({ timeout: 60_000 });
  await context.close();
});

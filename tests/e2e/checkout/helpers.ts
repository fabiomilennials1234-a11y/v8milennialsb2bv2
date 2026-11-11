/**
 * Comuns às duas specs do checkout.
 */
import { expect, type Frame, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';

export const SHOTS = process.env.CHECKOUT_E2E_SHOTS ?? join(process.env.CHECKOUT_E2E_DIST ?? '.', '..', 'torque-checkout-e2e-shots');
mkdirSync(SHOTS, { recursive: true });

export const BUYER = { name: 'Riofix Indústria Ltda', doc: '11.222.333/0001-81', docDigits: '11222333000181', email: 'financeiro@riofix.example.com' };
export const DIAGNOSTICS: Record<string, unknown> = {};
export const externalNotes = new Set<string>();
const root = new URL('../../../', import.meta.url);
const compact = (t: string) => t.replace(/\s+/g, ' ');
const OUR_CSP = [
  compact(/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(new URL('index.html', root), 'utf8'))![1]!),
  (JSON.parse(readFileSync(new URL('cloudflare/headers.json', root), 'utf8')) as { profiles: { app: Record<string, string> } }).profiles.app['Content-Security-Policy']!,
];

export const CARD_OK = '4242424242424242';
export const CARD_DECLINE = '4000000000000341';
export const CARD_3DS = '4000002760003184';

export async function control<T = Record<string, unknown>>(page: Page, path: string, body: unknown = {}): Promise<T> {
  const r = await page.request.post(`/__t/${path}`, { data: body, timeout: 120_000 });
  expect(r.ok()).toBe(true);
  return (await r.json()) as T;
}

export const shot = (page: Page, name: string, fullPage = true) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage, animations: 'disabled' });

/** CSP barrando alguma coisa é o defeito que parece falha de rede. */
export function watchViolations(page: Page) {
  const violations: string[] = [];
  const mask = (t: string) => t.replace(/(tq_pay_|_secret_)[A-Za-z0-9_]+/g, '$1***').slice(0, 300);
  page.on('console', (m) => {
    const t = m.text();
    if (/Permissions.Policy/i.test(t)) {
      externalNotes.add(mask(t));
    } else if (/Content Security Policy/i.test(t)) {
      // Só conta o que a NOSSA política barrou. A página de 3DS e o hCaptcha da Stripe têm a dela.
      const directive = /directive: "([^"]+)"/.exec(t)?.[1];
      if (directive && !OUR_CSP.some((csp) => csp.split(';').some((d) => d.trim() === directive))) externalNotes.add(mask(t));
      else violations.push(mask(t));
    }
  });
  page.on('pageerror', (e) => violations.push(`pageerror: ${mask(e.message)}`));
  return violations;
}

export async function fillBuyer(page: Page, { consent = true } = {}) {
  await page.getByLabel('Razão social ou nome').fill(BUYER.name);
  await page.getByLabel('CNPJ ou CPF').fill(BUYER.doc);
  await page.getByLabel('E-mail').fill(BUYER.email);
  if (consent) await page.getByRole('checkbox').check();
}

export function elementFrame(page: Page): Frame | Promise<Frame> {
  return (async () => {
    const handle = await page.locator('#checkout-payment-element iframe').first().elementHandle({ timeout: 60_000 });
    const frame = await handle!.contentFrame();
    return frame!;
  })();
}

export async function fillCard(page: Page, number: string) {
  const frame = await elementFrame(page);
  await frame.locator('input[name="number"]').waitFor({ timeout: 60_000 });
  await frame.locator('input[name="number"]').fill(number);
  await frame.locator('input[name="expiry"]').fill('12 / 34');
  await frame.locator('input[name="cvc"]').fill('123');
  const postal = frame.locator('input[name="postalCode"]');
  if (await postal.count()) await postal.fill('01310-100');
}

/** Até a etapa do cartão. Devolve o client_secret visto na rede, que nunca é impresso. */
export async function toCardStep(page: Page) {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/billing-checkout-subscription')),
    page.getByRole('button', { name: 'Continuar para o cartão' }).click(),
  ]);
  const body = (await response.json()) as { state: string; client_secret?: string };
  expect(body.state).toBe('ready');
  await expect(page.getByRole('heading', { name: 'Cartão' })).toBeFocused();
  return body.client_secret as string;
}

export async function pay(page: Page) {
  await page.getByRole('button', { name: /^Pagar / }).click();
}

/** Onde um segredo aparece no DOM: só tag e atributo, sem o valor. A Stripe monta os iframes dela. */
export function whereInDom(page: Page, needle: string) {
  return page.evaluate((n) => {
    const hits: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      for (const a of Array.from(el.attributes)) {
        if (a.value.includes(n)) {
          const inHash = a.name === 'src' && a.value.indexOf(n) > a.value.indexOf('#') && a.value.includes('#');
          hits.push(`${el.tagName.toLowerCase()}[${a.name}]${inHash ? '#fragmento' : ''} ${el.tagName === 'IFRAME' ? new URL((el as HTMLIFrameElement).src, location.href).host : ''}`.trim());
        }
      }
      if (el.children.length === 0 && el.textContent?.includes(n)) hits.push(`${el.tagName.toLowerCase()}:texto`);
    }
    return hits;
  }, needle);
}

export const confirmedHeading = (page: Page) => page.getByRole('heading', { name: 'Pagamento confirmado' });

/** Nada da Stripe pode parar num cache nosso. */
export const stripeInCaches = (page: Page) =>
  page.evaluate(async () => {
    const hits: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        if (/stripe/i.test(new URL(request.url).host)) hits.push(`${name}: ${new URL(request.url).host}`);
      }
    }
    return hits;
  });

/** Corpos de `replay_recording` dos envelopes, inflados. Sem isto a varredura olha bytes comprimidos. */
export function replayRecordings(envelopes: string[]): string[] {
  const out: string[] = [];
  for (const env of envelopes) {
    const buf = Buffer.from(env, 'latin1');
    for (const m of env.matchAll(/\{"type":"replay_recording"(?:,"length":(\d+))?[^}]*\}\n/g)) {
      const start = m.index! + m[0].length;
      const payload = buf.subarray(start, start + Number(m[1] ?? buf.length - start));
      const body = payload.subarray(payload.indexOf(10) + 1);
      for (const decode of [inflateSync, gunzipSync]) {
        try {
          out.push(decode(body).toString('utf8'));
          break;
        } catch {
          // Tenta o outro formato; se nenhum servir, vai cru para a varredura.
        }
      }
      if (!out.length) out.push(body.toString('latin1'));
    }
  }
  return out;
}

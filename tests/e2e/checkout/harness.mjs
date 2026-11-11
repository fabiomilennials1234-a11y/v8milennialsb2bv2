/**
 * Harness do Playwright do checkout: um servidor local, na mesma origem, com
 *  - o build real em `dist` servido com os headers REAIS de `cloudflare/headers.json`, e a
 *    CSP da meta do index.html também vale (o navegador aplica as duas);
 *  - as portas públicas /functions/v1/* ligadas à lógica real (`flow.ts`, `shape.ts`,
 *    `status.ts`, `handler.ts`, worker) sobre PGlite e Stripe em modo teste;
 *  - /__t/*: controle do teste (semear link, entregar eventos, ler estado);
 *  - /api/<id>/envelope: um Sentry de mentira, que só guarda o que o navegador mandou.
 *
 * `index.ts` das funções chama `Deno.serve` no topo e não importa no Node: o que está aqui é a
 * fiação daquele arquivo, e a lógica é a mesma.
 *
 * Só sobe em 127.0.0.1 e recusa chave que não seja de modo teste. Nunca imprime chave, token
 * nem client_secret.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve as resolvePath } from 'node:path';
import { register } from 'node:module';
import Stripe from 'stripe';

register('./npm-specifier-hook.mjs', import.meta.url);

const KEY = process.env.STRIPE_SECRET_KEY ?? '';
if (!/^(sk|rk)_test_/.test(KEY)) {
  console.error('harness: STRIPE_SECRET_KEY de modo teste é obrigatória');
  process.exit(9);
}
const PORT = Number(process.env.CHECKOUT_E2E_PORT ?? 8191);
const DIST = resolvePath(process.env.CHECKOUT_E2E_DIST ?? 'dist');
const WHSEC = ['whsec', 'local', 'prova'].join('_');

const root = new URL('../../../', import.meta.url);
const edge = (p) => import(new URL(`supabase/functions/${p}`, root).href);

const { all, checkoutDbAdapter, createBillingDb, one, rpcAdapter, seedLink, seedOrg, webhookDbAdapter } =
  await import(new URL('tests/helpers/stripe-billing-pglite.mjs', root).href);
const { createStripeGateway, createStripeSdk, stripeErrorInfo, verifyStripeWebhook } = await edge('_shared/stripe/client.ts');
const { readStripeConfig } = await edge('_shared/stripe/env.ts');
const { parseCheckoutInput, runCheckout } = await edge('billing-checkout-subscription/flow.ts');
const { handleStripeWebhook } = await edge('stripe-webhook/handler.ts');
const { provisionExistingOrgs } = await edge('billing-provision-worker/existing-org.ts');
const { shapePublicLink } = await edge('billing-payment-link/shape.ts');
const { resolverStatusDeTela } = await edge('billing-payment-status/status.ts');
const { isPlausibleLinkToken } = await edge('_shared/payment-link-token.ts');

const headersConfig = JSON.parse(readFileSync(new URL('cloudflare/headers.json', root), 'utf8'));
const APP_HEADERS = headersConfig.profiles.app;

const db = await createBillingDb();
const sdk = createStripeSdk(KEY);
const gateway = createStripeGateway(KEY);
const rpc = rpcAdapter(db);
const silent = async () => undefined;

const config = () => readStripeConfig((k) => ({ STRIPE_ENV: 'test', STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC })[k]);
const hashOf = (token) => createHash('sha256').update(token).digest('hex');

const sentryEnvelopes = [];
// O /sw.js que o navegador recebe: `legacy` é o cliente com a versão antiga instalada.
let swMode = 'current';
const startedAt = Math.floor(Date.now() / 1000) - 60;

async function linkEndpoint(body) {
  const token = body?.token;
  if (typeof token !== 'string' || !token) return [400, { error: 'malformed_body' }];
  if (!isPlausibleLinkToken(token)) return [200, { state: 'not_found' }];
  const { data, error } = await rpc('billing_resolve_payment_link', { p_token: token });
  if (error) return [500, { error: 'internal_error' }];
  const resolved = data ?? { ok: false, code: 'link_not_found' };
  let plan = { slug: null, name: null };
  let orgName = null;
  if (resolved.ok) {
    const row = await one(db, 'SELECT name, display_name FROM public.subscription_plans WHERE id = $1', [resolved.quote?.plan_id]);
    if (row) plan = { slug: row.name, name: row.display_name };
    if (resolved.organization_id) {
      orgName = (await one(db, 'SELECT name FROM public.organizations WHERE id = $1', [resolved.organization_id]))?.name ?? null;
    }
  }
  return [200, shapePublicLink(resolved, plan, orgName, new Date())];
}

async function statusEndpoint(body) {
  const token = body?.token;
  if (typeof token !== 'string' || !token) return [400, { error: 'malformed_body' }];
  if (!isPlausibleLinkToken(token)) return [200, { state: 'failed' }];
  const { data, error } = await rpc('billing_resolve_payment_link', { p_token: token });
  if (error) return [503, { error: 'unavailable' }];
  const r = data ?? {};
  return [200, resolverStatusDeTela({
    linkCode: typeof r.code === 'string' ? r.code : 'link_not_found',
    expiresAt: typeof r.expires_at === 'string' ? r.expires_at : null,
    eventos: [],
    now: new Date(),
  })];
}

async function checkoutEndpoint(body) {
  const input = parseCheckoutInput(body);
  if (!input) return [400, { error: 'malformed_body' }];
  const outcome = await runCheckout(input, {
    env: 'test',
    livemode: false,
    gateway,
    db: checkoutDbAdapter(db),
    describeError: stripeErrorInfo,
    log: silent,
  });
  return [outcome.status, outcome.body];
}

async function linkRow(token) {
  return one(db, `
    SELECT l.id, l.organization_id, l.paid_at, c.provider_subscription_id AS sub, c.provider_charge_id AS charge, c.attempt, b.provider_customer_id AS customer
      FROM public.payment_links l
      LEFT JOIN public.payment_link_charges c ON c.payment_link_id = l.id AND c.method = 'credit_card'
      LEFT JOIN public.payment_link_buyers b ON b.payment_link_id = l.id
     WHERE l.token_hash = $1`, [hashOf(token)]);
}

async function deliver(event) {
  const rawBody = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: WHSEC });
  return handleStripeWebhook({ rawBody, signature }, {
    config: config(),
    verify: (raw, sig) => verifyStripeWebhook(sdk, raw, sig, WHSEC),
    retrieveSubscription: (id) => gateway.retrieveSubscription(id),
    describeError: stripeErrorInfo,
    ...webhookDbAdapter(db),
    log: silent,
  });
}

/** Sem URL pública: lê os eventos reais e entrega assinados ao handler real; depois roda o worker. */
async function pump(token) {
  for (let i = 0; i < 40; i++) {
    const row = await linkRow(token);
    if (!row?.customer) throw new Error('link sem customer');
    const events = [];
    for await (const ev of sdk.events.list({ limit: 100, created: { gte: startedAt } })) {
      if (ev.data.object?.customer === row.customer) events.push(ev);
      if (events.length > 200) break;
    }
    events.sort((a, b) => a.created - b.created);
    for (const ev of events) await deliver(ev);
    const after = await linkRow(token);
    if (after.paid_at) {
      await provisionExistingOrgs(50, { rpc, log: silent });
      return state(token);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('invoice.paid não chegou');
}

async function state(token) {
  const row = await linkRow(token);
  const org = row ? await one(db, 'SELECT subscription_status, subscription_plan, subscription_expires_at FROM public.organizations WHERE id = $1', [row.organization_id]) : null;
  let periodEnd = null;
  let subscriptions = null;
  let activeSubscriptions = null;
  let paidInvoices = null;
  let invoice = null;
  if (row?.sub) {
    const sub = await sdk.subscriptions.retrieve(row.sub);
    periodEnd = sub.items.data[0]?.current_period_end ?? null;
    subscriptions = (await sdk.subscriptions.list({ customer: row.customer, status: 'all' })).data.length;
    activeSubscriptions = (await sdk.subscriptions.list({ customer: row.customer, status: 'active' })).data.length;
    paidInvoices = (await sdk.invoices.list({ customer: row.customer, status: 'paid' })).data.length;
    if (row.charge) invoice = await sdk.invoices.retrieve(row.charge);
  }
  const history = row ? await all(db, 'SELECT status FROM public.payment_history WHERE organization_id = $1', [row.organization_id]) : [];
  return {
    paid: !!row?.paid_at,
    attempt: row?.attempt ?? null,
    org_status: org?.subscription_status ?? null,
    org_expires_at: org?.subscription_expires_at ?? null,
    period_end: periodEnd,
    stripe_subscriptions: subscriptions,
    active_subscriptions: activeSubscriptions,
    paid_invoices: paidInvoices,
    invoice_name: invoice?.customer_name ?? null,
    invoice_email: invoice?.customer_email ?? null,
    invoice_tax_ids: (invoice?.customer_tax_ids ?? []).map((t) => t.value),
    history: history.length,
  };
}

async function seed(body) {
  const orgId = await seedOrg(db, { name: body.name ?? 'Riofix Indústria Ltda' });
  const link = await seedLink(db, {
    orgId,
    plan: body.plan ?? 'torque-v8',
    seats: body.seats ?? 3,
    cycle: body.cycle ?? 'semiannual',
    expiresAt: body.expiresAt ?? null,
  });
  if (body.revoked) await db.query('UPDATE public.payment_links SET revoked_at = now() WHERE id = $1', [link.linkId]);
  if (body.paid) await db.query('UPDATE public.payment_links SET paid_at = now() WHERE id = $1', [link.linkId]);
  return { token: link.token, amountCents: link.amountCents };
}

async function cleanup() {
  const rows = await all(db, `SELECT provider_subscription_id AS sub FROM public.payment_link_charges WHERE provider_subscription_id IS NOT NULL`);
  for (const { sub } of rows) {
    try { await sdk.subscriptions.cancel(sub); } catch { /* já cancelada */ }
  }
  return { cancelled: rows.length };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.mp4': 'video/mp4' };

function serveStatic(res, pathname) {
  if (pathname === '/sw.js' && swMode === 'legacy') {
    res.writeHead(200, { ...APP_HEADERS, 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(new URL('tests/e2e/checkout/legacy-sw.js', root)));
    return;
  }
  let file = join(DIST, decodeURIComponent(pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { ...APP_HEADERS, 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', ...(pathname === '/sw.js' ? { 'Cache-Control': 'no-cache' } : {}) });
  res.end(readFileSync(file));
}

const readBody = (req) => new Promise((ok, fail) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => ok(Buffer.concat(chunks)));
  req.on('error', fail);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    if (/^\/api\/\d+\/envelope\/?$/.test(url.pathname)) {
      sentryEnvelopes.push((await readBody(req)).toString('latin1'));
      return json(200, {});
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      const parse = async () => {
        try { return JSON.parse((await readBody(req)).toString('utf8')); } catch { return undefined; }
      };
      if (url.pathname.endsWith('/billing-payment-link')) return json(...(await linkEndpoint(await parse())));
      if (url.pathname.endsWith('/billing-payment-status')) return json(...(await statusEndpoint(await parse())));
      if (url.pathname.endsWith('/billing-checkout-subscription')) return json(...(await checkoutEndpoint(await parse())));
      return json(404, {});
    }
    // Sessão de mentira no teste de quem chega logado: o app só precisa de uma resposta.
    if (url.pathname.startsWith('/rest/v1/')) return json(200, []);
    if (url.pathname.startsWith('/auth/v1/')) return json(200, {});

    if (url.pathname === '/__t/sw') {
      swMode = JSON.parse((await readBody(req)).toString('utf8')).mode;
      return json(200, { mode: swMode });
    }
    if (url.pathname === '/__t/ping') return json(200, { ok: true });
    if (url.pathname === '/__t/seed') return json(200, await seed(JSON.parse((await readBody(req)).toString('utf8') || '{}')));
    if (url.pathname === '/__t/pump') return json(200, await pump(JSON.parse((await readBody(req)).toString('utf8')).token));
    if (url.pathname === '/__t/state') return json(200, await state(JSON.parse((await readBody(req)).toString('utf8')).token));
    if (url.pathname === '/__t/sentry') return json(200, { envelopes: sentryEnvelopes });
    if (url.pathname === '/__t/cleanup') return json(200, await cleanup());

    return serveStatic(res, url.pathname);
  } catch (e) {
    // Sem a mensagem crua: erro da Stripe pode carregar o PaymentIntent.
    console.error('harness: falha em', url.pathname, stripeErrorInfo(e).code ?? e?.name);
    json(500, { error: 'internal_error' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`harness em http://127.0.0.1:${PORT}`));

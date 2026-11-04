// @vitest-environment node
/**
 * Prova contra a Stripe real, em modo teste: flow.ts, client.ts, handler.ts e worker
 * reais, banco em PGlite, eventos lidos de GET /v1/events e entregues ao handler com
 * assinatura local (sem URL pública: entrega de rede real exige deploy).
 *
 * Só roda com STRIPE_REAL_TEST=1 e chave sk_test_/rk_test_ em STRIPE_SECRET_KEY. Nunca
 * com chave live: a guarda abaixo aborta. Cria objetos de teste na conta.
 *
 *   STRIPE_REAL_TEST=1 STRIPE_SECRET_KEY=... npx vitest run tests/integration/stripe-real.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";
import {
  all, checkoutDbAdapter, createBillingDb, one, rpcAdapter, seedLink, seedOrg, webhookDbAdapter,
} from "../helpers/stripe-billing-pglite.mjs";
import { createStripeGateway, createStripeSdk, stripeErrorInfo, verifyStripeWebhook } from "../../supabase/functions/_shared/stripe/client.ts";
import { readStripeConfig } from "../../supabase/functions/_shared/stripe/env.ts";
import { RECURRING_CONSENT_VERSION, runCheckout, type CheckoutDeps, type CheckoutInput } from "../../supabase/functions/billing-checkout-subscription/flow.ts";
import { handleStripeWebhook } from "../../supabase/functions/stripe-webhook/handler.ts";
import { provisionExistingOrgs } from "../../supabase/functions/billing-provision-worker/existing-org.ts";

const KEY = process.env.STRIPE_SECRET_KEY ?? "";
const LIGADO = process.env.STRIPE_REAL_TEST === "1" && /^(sk|rk)_test_/.test(KEY);
const WHSEC = ["whsec", "local", "prova"].join("_");
const CONSENT = { accepted: true, version: RECURRING_CONSENT_VERSION };
const BUYER = { legal_name: "Empresa Prova LTDA", email: "prova@example.invalid", tax_id: "11222333000181" };

describe.skipIf(!LIGADO)("Stripe real em modo teste", () => {
  let db: PGlite;
  let sdk: Stripe;
  const criados: string[] = [];
  const subsParaCancelar: string[] = [];

  const deps = (): CheckoutDeps => ({
    env: "test",
    livemode: false,
    gateway: createStripeGateway(KEY),
    db: checkoutDbAdapter(db),
    describeError: stripeErrorInfo,
    log: async () => undefined,
  });

  const config = () => readStripeConfig((k) => ({ STRIPE_ENV: "test", STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: WHSEC } as Record<string, string>)[k]);

  const entregar = async (ev: Stripe.Event) => {
    const rawBody = JSON.stringify(ev);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: WHSEC });
    return handleStripeWebhook({ rawBody, signature }, {
      config: config(),
      verify: (raw, sig) => verifyStripeWebhook(sdk, raw, sig, WHSEC),
      retrieveSubscription: (id) => createStripeGateway(KEY).retrieveSubscription(id),
      describeError: stripeErrorInfo,
      ...webhookDbAdapter(db),
      log: async () => undefined,
    });
  };

  /** Eventos que citam o Customer, do mais antigo ao mais novo, esperando pelos tipos pedidos. */
  async function eventosDe(customer: string, espera: (tipos: string[]) => boolean): Promise<Stripe.Event[]> {
    for (let i = 0; i < 40; i++) {
      const achados: Stripe.Event[] = [];
      for await (const ev of sdk.events.list({ limit: 100, created: { gte: Math.floor(Date.now() / 1000) - 3600 } })) {
        const o = ev.data.object as unknown as Record<string, unknown>;
        if (o.customer === customer) achados.push(ev);
        if (achados.length > 400) break;
      }
      achados.sort((a, b) => a.created - b.created);
      if (espera(achados.map((e) => e.type))) return achados;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("eventos não chegaram");
  }

  const contar = (tipos: string[], t: string) => tipos.filter((x) => x === t).length;

  /**
   * Nenhuma saída deste arquivo pode conter client_secret, nem em falha de asserção: o
   * diff do vitest imprime o objeto inteiro, e erro da Stripe carrega o PaymentIntent.
   */
  const semSegredo = (body: Record<string, unknown>) => {
    const { client_secret, ...resto } = body;
    return { ...resto, tem_segredo: typeof client_secret === "string" };
  };
  const checkout = async (input: Pick<CheckoutInput, "token"> & { buyer?: CheckoutInput["buyer"] }) => {
    const r = await runCheckout({ buyer: BUYER, consent: CONSENT, ...input }, deps());
    const body = r.body as Record<string, unknown>;
    return { status: r.status, secret: (body.client_secret as string | undefined) ?? "", view: semSegredo(body) };
  };

  async function confirmar(secret: string, pm: string): Promise<string> {
    try {
      return (await sdk.paymentIntents.confirm(secret.split("_secret_")[0], { payment_method: pm })).status;
    } catch (e) {
      return `erro:${(e as { code?: string }).code ?? "desconhecido"}`;
    }
  }

  const worker = () => provisionExistingOrgs(50, { rpc: rpcAdapter(db), log: async () => undefined });

  beforeAll(async () => {
    expect(KEY.includes("_live_")).toBe(false);
    sdk = createStripeSdk(KEY);
    db = await createBillingDb();
  }, 60_000);

  afterAll(async () => {
    for (const id of subsParaCancelar) {
      try { await sdk.subscriptions.cancel(id); } catch { /* já cancelada */ }
    }
    console.info("objetos de teste criados:", JSON.stringify(criados));
    await db?.close();
  }, 180_000);

  it("critérios 1, 2, 4 e 6: Customer novo, reload, pagamento, webhook, worker, org active", async () => {
    const orgId = await seedOrg(db, { status: "suspended" });
    const link = await seedLink(db, { orgId, plan: "torque-v8", seats: 5, cycle: "monthly" });

    const a = await checkout({ token: link.token });
    expect(a.view).toEqual({ state: "ready", livemode: false, amount_cents: 223700, billing_cycle: "monthly", tem_segredo: true });

    // Critério 2: recarregar devolve o mesmo PaymentIntent, sem assinatura nova.
    const b = await checkout({ token: link.token });
    expect(b.secret === a.secret).toBe(true);

    const charge = await one(db, "SELECT provider_subscription_id s, provider_customer_id c, provider_charge_id i, attempt FROM public.payment_link_charges WHERE payment_link_id=$1", [link.linkId]);
    expect(charge.attempt).toBe(1);
    criados.push(charge.c, charge.s);
    subsParaCancelar.push(charge.s);
    expect((await sdk.subscriptions.list({ customer: charge.c, status: "all" })).data).toHaveLength(1);

    // Catálogo real: Price por lookup_key, sem price_data.
    const remota = await sdk.subscriptions.retrieve(charge.s);
    expect(remota.items.data.map((i) => [i.price.lookup_key, i.quantity]).sort()).toEqual([["torque_v8_plan_monthly", 1], ["torque_v8_seat_monthly", 2]]);

    expect(await confirmar(a.secret, "pm_card_visa")).toBe("succeeded");

    const eventos = await eventosDe(charge.c, (t) => contar(t, "invoice.paid") === 1 && contar(t, "customer.subscription.updated") >= 1);
    for (const ev of eventos) expect((await entregar(ev)).status).toBe(200);

    expect(await worker()).toMatchObject({ feito: [charge.i], falhou: [] });

    const org = await one(db, "SELECT subscription_status s, subscription_plan p, subscription_expires_at e FROM public.organizations WHERE id=$1", [orgId]);
    const periodEnd = (await sdk.subscriptions.retrieve(charge.s)).items.data[0].current_period_end;
    expect(org.s).toBe("active");
    expect(org.p).toBe("torque-v8");
    // Critério 1: validade == current_period_end.
    expect(new Date(org.e).getTime()).toBe(periodEnd * 1000);

    // Critério 6.
    const { r } = await one(db, "SELECT public.org_get_features_and_limits($1) r", [orgId]);
    expect(r.features.copilot).toBe(true);
    expect(r.limits.max_users).toBe(5);

    // Critério 4: reentrega de tudo, embaralhada, não muda nada.
    const antes = await one(db, "SELECT count(*)::int h, (SELECT count(*)::int FROM public.subscription_provisionings WHERE organization_id=$1) p FROM public.payment_history WHERE organization_id=$1", [orgId]);
    for (const ev of [...eventos].reverse()) expect((await entregar(ev)).status).toBe(200);
    await worker();
    expect(await one(db, "SELECT count(*)::int h, (SELECT count(*)::int FROM public.subscription_provisionings WHERE organization_id=$1) p FROM public.payment_history WHERE organization_id=$1", [orgId])).toEqual(antes);
    expect(new Date((await one(db, "SELECT subscription_expires_at e FROM public.organizations WHERE id=$1", [orgId])).e).getTime()).toBe(periodEnd * 1000);

    // Critério 10, com objeto real: nada do comprador no ledger.
    const ledger = JSON.stringify(await all(db, "SELECT payload, error_message FROM public.payment_webhook_events"));
    for (const v of [BUYER.email, BUYER.legal_name, "11.222.333", "_secret_", "hosted_invoice_url"]) expect(ledger).not.toContain(v);
  }, 180_000);

  it("critério 5: renovação por test clock: +1 histórico, +1 provisão, validade realinhada", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2, cycle: "monthly" });

    const clock = await sdk.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: "prova-renovacao" });
    const customer = await sdk.customers.create({ name: BUYER.legal_name, email: BUYER.email, test_clock: clock.id, tax_id_data: [{ type: "br_cnpj", value: "11.222.333/0001-81" }] });
    criados.push(clock.id, customer.id);
    await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe',$2,false)", [orgId, customer.id]);

    const a = await checkout({ token: link.token });
    expect(a.view).toMatchObject({ state: "ready", amount_cents: 59400 });
    const { s: subId, i: invoice1 } = await one(db, "SELECT provider_subscription_id s, provider_charge_id i FROM public.payment_link_charges WHERE payment_link_id=$1", [link.linkId]);
    criados.push(subId);
    subsParaCancelar.push(subId);

    expect(await confirmar(a.secret, "pm_card_visa")).toBe("succeeded");

    const primeiros = await eventosDe(customer.id, (t) => contar(t, "invoice.paid") === 1);
    for (const ev of primeiros) await entregar(ev);
    expect((await worker()).feito).toEqual([invoice1]);
    const v1 = (await one(db, "SELECT subscription_expires_at e FROM public.organizations WHERE id=$1", [orgId])).e;

    const fim1 = (await sdk.subscriptions.retrieve(subId)).items.data[0].current_period_end;
    await sdk.testHelpers.testClocks.advance(clock.id, { frozen_time: fim1 + 7200 });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      if ((await sdk.testHelpers.testClocks.retrieve(clock.id)).status === "ready") break;
    }

    const todos = await eventosDe(customer.id, (t) => contar(t, "invoice.paid") === 2);
    // Fora de ordem de propósito: a renovação chega antes do espelho.
    const novos = todos.filter((e) => !primeiros.some((p) => p.id === e.id));
    for (const ev of [...novos].reverse()) expect((await entregar(ev)).status).toBe(200);

    const r = await worker();
    expect(r.feito).toHaveLength(1);
    expect(r.feito[0]).not.toBe(invoice1);

    const fim2 = (await sdk.subscriptions.retrieve(subId)).items.data[0].current_period_end;
    const v2 = (await one(db, "SELECT subscription_expires_at e FROM public.organizations WHERE id=$1", [orgId])).e;
    expect(new Date(v2).getTime()).toBe(fim2 * 1000);
    expect(new Date(v2).getTime()).toBeGreaterThan(new Date(v1).getTime());
    // Realinhar, não somar: a validade é o fim do ciclo, não fim1 + 2 meses.
    expect(fim2 - fim1).toBeLessThan(32 * 86400);

    const h = await all(db, "SELECT provider_payment_id, status, period_start::text ps, period_end::text pe FROM public.payment_history WHERE organization_id=$1 ORDER BY period_start", [orgId]);
    expect(h).toHaveLength(2);
    expect(h.every((x: { status: string }) => x.status === "received")).toBe(true);
    expect(h[1].ps).toBe(new Date(fim1 * 1000).toISOString().slice(0, 10));
    expect(await all(db, "SELECT 1 FROM public.subscription_provisionings WHERE organization_id=$1", [orgId])).toHaveLength(2);
  }, 300_000);

  it("critério 3 (servidor): recusa e novo cartão no mesmo fluxo", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2, cycle: "monthly" });
    const comCpf = { ...BUYER, tax_id: "11144477735" };
    const { secret } = await checkout({ token: link.token, buyer: comCpf });
    const { s, c } = await one(db, "SELECT provider_subscription_id s, provider_customer_id c FROM public.payment_link_charges WHERE payment_link_id=$1", [link.linkId]);
    criados.push(c, s);
    subsParaCancelar.push(s);

    expect(await confirmar(secret, "pm_card_chargeCustomerFail")).toBe("erro:card_declined");

    // Recarregar depois da recusa devolve o mesmo fluxo.
    const recarga = await checkout({ token: link.token, buyer: comCpf });
    expect(recarga.view).toMatchObject({ state: "ready" });
    expect(recarga.secret === secret).toBe(true);

    expect(await confirmar(secret, "pm_card_visa")).toBe("succeeded");

    const eventos = await eventosDe(c, (t) => contar(t, "invoice.paid") === 1 && contar(t, "invoice.payment_failed") === 1);
    for (const ev of eventos) expect((await entregar(ev)).status).toBe(200);
    const h = await all(db, "SELECT status FROM public.payment_history WHERE organization_id=$1", [orgId]);
    expect(h).toEqual([{ status: "received" }]);
    expect((await worker()).falhou).toEqual([]);
    expect((await one(db, "SELECT subscription_status s FROM public.organizations WHERE id=$1", [orgId])).s).toBe("active");
  }, 180_000);

  it("critério 7: preço negociado com resto de centavo vira itens que somam o link", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 3, cycle: "monthly", manual: 26668, reason: "negociado" });
    const a = await checkout({ token: link.token });
    expect(a.view).toMatchObject({ state: "ready", amount_cents: 26668 });
    const { s, c, i } = await one(db, "SELECT provider_subscription_id s, provider_customer_id c, provider_charge_id i FROM public.payment_link_charges WHERE payment_link_id=$1", [link.linkId]);
    criados.push(c, s);
    subsParaCancelar.push(s);
    expect((await sdk.invoices.retrieve(i)).amount_due).toBe(26668);
    const itens = (await sdk.subscriptions.retrieve(s)).items.data.map((x) => [x.price.product, x.price.unit_amount, x.quantity]);
    expect(itens.sort()).toEqual([["torque_1_0_plan", 1, 1], ["torque_1_0_seat", 8889, 3]]);
  }, 120_000);

  it("critério 7: ciclo semestral usa a Price do catálogo e cobra o valor do motor", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-2.0", seats: 6, cycle: "semiannual" });
    const a = await checkout({ token: link.token });
    expect(a.view).toMatchObject({ state: "ready", amount_cents: 376380 * 6, billing_cycle: "semiannual" });
    const { s, c, i } = await one(db, "SELECT provider_subscription_id s, provider_customer_id c, provider_charge_id i FROM public.payment_link_charges WHERE payment_link_id=$1", [link.linkId]);
    criados.push(c, s);
    subsParaCancelar.push(s);
    expect((await sdk.invoices.retrieve(i)).amount_due).toBe(376380 * 6);
    const it0 = (await sdk.subscriptions.retrieve(s)).items.data[0];
    expect(it0.price.lookup_key).toBe("torque_2_0_seat_semiannual");
    expect(it0.price.recurring).toMatchObject({ interval: "month", interval_count: 6 });
  }, 120_000);

  it("critério 8: outro link da mesma org é recusado sem objeto novo na Stripe", async () => {
    const orgId = await seedOrg(db);
    const l1 = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    await checkout({ token: l1.token });
    const { s, c } = await one(db, "SELECT provider_subscription_id s, provider_customer_id c FROM public.payment_link_charges WHERE payment_link_id=$1", [l1.linkId]);
    criados.push(c, s);
    subsParaCancelar.push(s);

    const l2 = await seedLink(db, { orgId, plan: "torque-v8", seats: 3 });
    expect((await checkout({ token: l2.token })).view).toEqual({ state: "org_already_subscribed", tem_segredo: false });
    expect((await sdk.subscriptions.list({ customer: c, status: "all" })).data).toHaveLength(1);

    // Controle positivo: cancelada a primeira, o segundo link passa.
    await sdk.subscriptions.cancel(s);
    const liberado = await checkout({ token: l2.token });
    expect(liberado.view).toMatchObject({ state: "ready" });
    const s2 = (await one(db, "SELECT provider_subscription_id s FROM public.payment_link_charges WHERE payment_link_id=$1", [l2.linkId])).s;
    criados.push(s2);
    subsParaCancelar.push(s2);
    // E reusa o Customer da org.
    expect((await sdk.subscriptions.list({ customer: c, status: "all" })).data).toHaveLength(2);
  }, 120_000);

  it("a Stripe aceita CNPJ com DV errado: é o flow que recusa, antes dela", async () => {
    const custo = await sdk.customers.create({
      name: BUYER.legal_name,
      email: BUYER.email,
      tax_id_data: [{ type: "br_cnpj", value: "12.345.678/9012-34" }],
    });
    criados.push(custo.id);
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    const r = await checkout({ token: link.token, buyer: { ...BUYER, tax_id: "12345678901234" } });
    expect(r.view).toEqual({ state: "tax_id_invalid", tem_segredo: false });
  }, 60_000);

  it("B2: sem consentimento não nasce objeto; com ele a metadata carrega a versão", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    const sem = await runCheckout({ token: link.token, buyer: BUYER, consent: null }, deps());
    expect(sem.body).toEqual({ state: "consent_required", consent_version: RECURRING_CONSENT_VERSION });
    expect(await all(db, "SELECT 1 FROM public.org_billing_customers WHERE organization_id=$1", [orgId])).toHaveLength(0);

    await checkout({ token: link.token });
    const { s, c } = await one(db, "SELECT provider_subscription_id s, provider_customer_id c FROM public.payment_link_charges WHERE payment_link_id=$1", [link.linkId]);
    criados.push(c, s);
    subsParaCancelar.push(s);
    expect((await sdk.subscriptions.retrieve(s)).metadata.torque_consent_version).toBe(RECURRING_CONSENT_VERSION);
    expect(await one(db, "SELECT recurring_consent_version v, recurring_consent_at IS NOT NULL a FROM public.payment_link_buyers WHERE payment_link_id=$1", [link.linkId]))
      .toEqual({ v: RECURRING_CONSENT_VERSION, a: true });
  }, 60_000);

  it("N9: metadata de assinatura incompleta atualiza de verdade no reuso, com o mesmo secret", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    const a = await checkout({ token: link.token });
    const { s, c } = await one(db, "SELECT provider_subscription_id s, provider_customer_id c FROM public.payment_link_charges WHERE payment_link_id=$1", [link.linkId]);
    criados.push(c, s);
    subsParaCancelar.push(s);

    // Simula assinatura criada sob a versão anterior do texto.
    const antiga = await sdk.subscriptions.update(s, { metadata: { torque_consent_version: "versao-antiga" } });
    expect(antiga.status).toBe("incomplete");
    expect(antiga.metadata.torque_consent_version).toBe("versao-antiga");

    const b = await checkout({ token: link.token });
    expect(b.secret === a.secret).toBe(true);

    const depois = await sdk.subscriptions.retrieve(s);
    expect(depois.status).toBe("incomplete");
    expect(depois.metadata.torque_consent_version).toBe(RECURRING_CONSENT_VERSION);
    // Update faz merge: os outros ids continuam.
    expect(depois.metadata.torque_link_id).toBe(link.linkId);
    expect(depois.metadata.torque_org_id).toBe(orgId);
    expect((await sdk.subscriptions.list({ customer: c, status: "all" })).data).toHaveLength(1);
  }, 60_000);

  it("N9: N2 real: incompleta de link revogado é cancelada na Stripe e o novo link segue", async () => {
    const orgId = await seedOrg(db);
    const revogado = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    await checkout({ token: revogado.token });
    const { s, c } = await one(db, "SELECT provider_subscription_id s, provider_customer_id c FROM public.payment_link_charges WHERE payment_link_id=$1", [revogado.linkId]);
    criados.push(c, s);
    expect((await sdk.subscriptions.retrieve(s)).status).toBe("incomplete");

    // Controle positivo: com o link vivo, o segundo link é barrado e nada é cancelado.
    const novo = await seedLink(db, { orgId, plan: "torque-v8", seats: 3 });
    expect((await checkout({ token: novo.token })).view).toEqual({ state: "org_already_subscribed", tem_segredo: false });
    expect((await sdk.subscriptions.retrieve(s)).status).toBe("incomplete");

    await db.query("UPDATE public.payment_links SET revoked_at = now() WHERE id=$1", [revogado.linkId]);
    const liberado = await checkout({ token: novo.token });
    expect(liberado.view).toMatchObject({ state: "ready" });

    // Cancelar incompleta na Stripe termina em incomplete_expired.
    expect(["incomplete_expired", "canceled"]).toContain((await sdk.subscriptions.retrieve(s)).status);
    const s2 = (await one(db, "SELECT provider_subscription_id s FROM public.payment_link_charges WHERE payment_link_id=$1", [novo.linkId])).s;
    criados.push(s2);
    subsParaCancelar.push(s2);
    expect((await sdk.subscriptions.retrieve(s2)).status).toBe("incomplete");
    expect((await sdk.subscriptions.retrieve(s2)).customer).toBe(c);
  }, 60_000);

  it("N8 real: corrida com dois documentos converge para o atual", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    await checkout({ token: link.token });
    const { s, c } = await one(db, "SELECT provider_subscription_id s, provider_customer_id c FROM public.payment_link_charges WHERE payment_link_id=$1", [link.linkId]);
    criados.push(c, s);
    subsParaCancelar.push(s);
    await sdk.customers.createTaxId(c, { type: "br_cnpj", value: "11.444.777/0001-61" });
    expect((await sdk.customers.listTaxIds(c)).data).toHaveLength(2);

    await checkout({ token: link.token });
    expect((await sdk.customers.listTaxIds(c)).data.map((t) => t.value)).toEqual(["11.222.333/0001-81"]);
  }, 60_000);

  /** Assinatura, invoice e Customer atuais do link. */
  const doLink = (linkId: string) =>
    one(db, "SELECT provider_subscription_id s, provider_customer_id c, provider_charge_id i, attempt FROM public.payment_link_charges WHERE payment_link_id=$1", [linkId]) as Promise<{ s: string; c: string; i: string; attempt: number }>;

  it("Q4: Alterar antes de pagar: fatura velha anulada, secret velho morto, a nova sai com o comprador certo", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    const a = await checkout({ token: link.token });
    const velha = await doLink(link.linkId);
    criados.push(velha.c);
    subsParaCancelar.push(velha.s);

    const trocado = { legal_name: "Empresa Corrigida LTDA", email: "correto@example.invalid", tax_id: "11444777000161" };
    const b = await checkout({ token: link.token, buyer: trocado });
    const nova = await doLink(link.linkId);
    subsParaCancelar.push(nova.s);

    expect(b.secret === a.secret).toBe(false);
    expect(nova.attempt).toBe(2);
    expect(nova.s === velha.s).toBe(false);
    expect((await sdk.invoices.retrieve(velha.i)).status).toBe("void");
    expect((await sdk.subscriptions.retrieve(velha.s)).status).toMatch(/canceled|incomplete_expired/);

    // Fatura nova com o comprador corrigido. Sem isto a nota sairia em nome do antigo.
    const fatura = await sdk.invoices.retrieve(nova.i);
    expect(fatura.customer_name).toBe("Empresa Corrigida LTDA");
    expect(fatura.customer_email).toBe("correto@example.invalid");
    expect((fatura.customer_tax_ids ?? []).map((t) => t.value)).toEqual(["11.444.777/0001-61"]);

    // Aba que ficou com o secret velho não consegue pagar.
    expect(await confirmar(a.secret, "pm_card_visa")).toMatch(/^erro:/);
    expect(await confirmar(b.secret, "pm_card_visa")).toBe("succeeded");

    // Repetir o mesmo comprador corrigido reusa em vez de trocar de novo: já é a paga.
    const pagas = (await sdk.invoices.list({ customer: nova.c, status: "paid" })).data;
    expect(pagas.map((i) => i.id)).toEqual([nova.i]);
  }, 90_000);

  it("Q4: pago na outra aba antes do POST: already_paid, sem anular nem tocar em comprador", async () => {
    const orgId = await seedOrg(db);
    const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    const a = await checkout({ token: link.token });
    const velha = await doLink(link.linkId);
    criados.push(velha.c);
    subsParaCancelar.push(velha.s);
    expect(await confirmar(a.secret, "pm_card_visa")).toBe("succeeded");

    const r = await checkout({ token: link.token, buyer: { ...BUYER, tax_id: "11444777000161" } });
    expect(r.view.state).toBe("already_paid");
    expect((await sdk.subscriptions.retrieve(velha.s)).status).toBe("active");
    expect((await sdk.customers.listTaxIds(velha.c)).data.map((t) => t.value)).toEqual(["11.222.333/0001-81"]);
  }, 60_000);

  it("Q4: duas abas ao mesmo tempo, uma paga e a outra troca o comprador: nunca duas cobranças", async () => {
    for (let rodada = 0; rodada < 3; rodada++) {
      const orgId = await seedOrg(db);
      const link = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
      const a = await checkout({ token: link.token });
      const velha = await doLink(link.linkId);
      criados.push(velha.c);
      subsParaCancelar.push(velha.s);

      const [pagamento, troca] = await Promise.all([
        confirmar(a.secret, "pm_card_visa"),
        checkout({ token: link.token, buyer: { ...BUYER, legal_name: `Outra ${rodada} LTDA` } }),
      ]);

      const atual = await doLink(link.linkId);
      subsParaCancelar.push(atual.s);
      // Quem chegou por último nunca paga em cima: se a aba pagou, o POST acaba em already_paid
      // ou devolve o secret novo sem que a assinatura paga seja cortada.
      if (troca.secret) {
        const estadoAntiga = (await sdk.subscriptions.retrieve(velha.s)).status;
        if (pagamento === "succeeded") expect(estadoAntiga).toBe("active");
      }
      const pagas = (await sdk.invoices.list({ customer: velha.c, status: "paid" })).data;
      expect(pagas.length).toBeLessThanOrEqual(1);
      const vivas = (await sdk.subscriptions.list({ customer: velha.c, status: "active" })).data;
      expect(vivas.length).toBe(pagas.length);
      // Se pagou, a nova incompleta (se nasceu) não pode ser paga por engano: o POST seguinte recusa.
      if (pagas.length === 1 && atual.s !== pagas[0]!.parent?.subscription_details?.subscription) {
        await sdk.subscriptions.cancel(atual.s).catch(() => undefined);
      }
    }
  }, 180_000);

  it("N4: Customer fica com o documento novo, e a fatura já anulada guarda o antigo como retrato", async () => {
    const orgId = await seedOrg(db);
    const l1 = await seedLink(db, { orgId, plan: "torque-1.0", seats: 2 });
    await checkout({ token: l1.token });
    const { s, c, i } = await doLink(l1.linkId);
    criados.push(c, s);
    subsParaCancelar.push(s);

    await checkout({ token: l1.token, buyer: { ...BUYER, tax_id: "11444777000161" } });
    subsParaCancelar.push((await doLink(l1.linkId)).s);

    expect((await sdk.customers.listTaxIds(c)).data.map((t) => t.value)).toEqual(["11.444.777/0001-61"]);
    const fatura = await sdk.invoices.retrieve(i);
    expect((fatura.customer_tax_ids ?? []).map((t) => t.value)).toEqual(["11.222.333/0001-81"]);
  }, 60_000);
});

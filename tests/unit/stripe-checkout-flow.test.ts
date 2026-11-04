// @vitest-environment node
/**
 * Fluxo do checkout: gateway fake que registra chamadas, banco real (PGlite como
 * service_role). Critérios 8, 10 e 11 nesta camada; o caminho real está em
 * tests/integration/stripe-real.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  all, checkoutDbAdapter, createBillingDb, one, paidArgs, rpcAdapter, seedEvent, seedLink, seedOrg,
} from "../helpers/stripe-billing-pglite.mjs";
import {
  isValidBrTaxId, parseCheckoutInput, rateLimitKey, RECURRING_CONSENT_VERSION, runCheckout, stripeTaxId, withinRateLimit,
  type CheckoutDeps, type CheckoutLogEntry,
} from "../../supabase/functions/billing-checkout-subscription/flow.ts";
import type { StripeGateway } from "../../supabase/functions/_shared/stripe/client.ts";
import type { SubscriptionView } from "../../supabase/functions/_shared/stripe/events.ts";
import { catalogPrices } from "../../supabase/functions/_shared/stripe/catalog.ts";

let base: PGlite;
let db: PGlite;
let logs: CheckoutLogEntry[];
let subs: Map<string, SubscriptionView>;
let gateway: { [K in keyof StripeGateway]: ReturnType<typeof vi.fn> };
let contador = 0;

const SECRET_OF = (id: string) => `pi_${id}_secret_valor`;
const BUYER = { legal_name: "  Empresa Real LTDA ", email: " Comprador@Empresa.COM.BR ", tax_id: "11.222.333/0001-81" };

function novaAssinatura(status = "incomplete", hash: string | null = null): SubscriptionView {
  contador += 1;
  const id = `sub_${contador}`;
  const s: SubscriptionView = {
    id, status, customerId: "cus_novo", latestInvoiceId: `in_${contador}`, clientSecret: SECRET_OF(id),
    cancelAtPeriodEnd: false, periodEnd: null, endedAt: null, livemode: false, consentVersion: RECURRING_CONSENT_VERSION,
    buyerHash: hash,
  };
  subs.set(id, s);
  return s;
}

function deps(): CheckoutDeps {
  return {
    env: "test",
    livemode: false,
    gateway: gateway as unknown as StripeGateway,
    db: checkoutDbAdapter(db),
    describeError: (e) => ({ type: String((e as { type?: string }).type ?? "unknown"), code: (e as { code?: string }).code ?? null, requestId: null }),
    log: async (e) => { logs.push(e); },
  };
}

beforeAll(async () => { base = await createBillingDb(); }, 60_000);
beforeEach(async () => {
  db = await base.clone();
  logs = [];
  subs = new Map();
  contador = 0;
  gateway = {
    listPricesByLookupKeys: vi.fn(async (keys: string[]) =>
      catalogPrices().filter((p) => keys.includes(p.lookup_key)).map((p) => ({ id: `price_${p.lookup_key}`, lookup_key: p.lookup_key, unit_amount: p.unit_amount }))),
    createCustomer: vi.fn(async () => "cus_novo"),
    updateCustomer: vi.fn(async () => undefined),
    listCustomerTaxIds: vi.fn(async () => [{ id: "txi_1", value: "11.222.333/0001-81" }]),
    createCustomerTaxId: vi.fn(async () => "txi_novo"),
    deleteCustomerTaxId: vi.fn(async () => undefined),
    createSubscription: vi.fn(async (p: { metadata: Record<string, string> }) => novaAssinatura("incomplete", p.metadata.torque_buyer_hash ?? null)),
    updateSubscriptionMetadata: vi.fn(async () => undefined),
    retrieveSubscription: vi.fn(async (id: string) => subs.get(id)!),
    cancelSubscription: vi.fn(async () => undefined),
    voidInvoice: vi.fn(async () => "voided"),
    deleteCustomer: vi.fn(async () => undefined),
  };
});
afterEach(async () => { await db.close(); });

const CONSENT = { accepted: true, version: RECURRING_CONSENT_VERSION };
const run = (token: string, buyer = BUYER, consent: { accepted: boolean; version: string } | null = CONSENT) =>
  runCheckout({ token, buyer, consent }, deps());

async function linkPronto(over: Record<string, unknown> = {}) {
  const orgId = (over.orgId as string) ?? await seedOrg(db);
  const link = await seedLink(db, { ...over, orgId });
  return { orgId, ...link };
}

describe("feliz", () => {
  it("cria Customer e assinatura, amarra ao link e devolve ready", async () => {
    const { token, linkId, orgId, amountCents } = await linkPronto();
    const r = await run(token);
    expect(r).toEqual({
      status: 200,
      body: { state: "ready", client_secret: SECRET_OF("sub_1"), livemode: false, amount_cents: amountCents, billing_cycle: "monthly" },
    });

    const [cust, keyCust] = gateway.createCustomer.mock.calls[0];
    expect(cust).toMatchObject({ name: "Empresa Real LTDA", email: "comprador@empresa.com.br", taxId: { type: "br_cnpj", value: "11.222.333/0001-81" } });
    expect(cust.metadata).toEqual({ torque_env: "test", torque_org_id: orgId });
    expect(keyCust).toMatch(new RegExp(`^torque:customer:${orgId}:[0-9a-f]{16}$`));

    const [params, keySub] = gateway.createSubscription.mock.calls[0];
    expect(keySub).toBe(`torque:sub:${linkId}:1:${RECURRING_CONSENT_VERSION}`);
    expect(params.items).toEqual([{ price: "price_torque_v8_plan_monthly", quantity: 1 }]);
    expect(params.metadata.torque_buyer_hash).toMatch(/^[0-9a-f]{16}$/);
    expect({ ...params.metadata, torque_buyer_hash: undefined }).toEqual({ torque_buyer_hash: undefined, torque_env: "test", torque_link_id: linkId, torque_org_id: orgId, torque_attempt: "1", torque_consent_version: RECURRING_CONSENT_VERSION });

    expect(await one(db, "SELECT provider, provider_subscription_id, provider_charge_id, provider_customer_id, attempt FROM public.payment_link_charges WHERE payment_link_id=$1", [linkId]))
      .toEqual({ provider: "stripe", provider_subscription_id: "sub_1", provider_charge_id: "in_1", provider_customer_id: "cus_novo", attempt: 1 });
    expect(await one(db, "SELECT provider_customer_id, livemode FROM public.org_billing_customers WHERE organization_id=$1", [orgId]))
      .toEqual({ provider_customer_id: "cus_novo", livemode: false });
    expect(await one(db, "SELECT provider, provider_customer_id, email, tax_id, tax_id_kind FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId]))
      .toEqual({ provider: "stripe", provider_customer_id: "cus_novo", email: "comprador@empresa.com.br", tax_id: "11222333000181", tax_id_kind: "cnpj" });
  });

  it("amarra ANTES de responder: falha no attach não entrega secret", async () => {
    const { token } = await linkPronto();
    await db.exec(`CREATE FUNCTION public.boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'x' USING ERRCODE='XX000'; END $$;
      CREATE TRIGGER boom BEFORE INSERT ON public.payment_link_charges FOR EACH ROW EXECUTE FUNCTION public.boom();`);
    const r = await run(token);
    expect(r).toEqual({ status: 500, body: { error: "internal_error" } });
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("cupom e preço negociado usam price_data, com soma == valor do link", async () => {
    const { token, amountCents } = await linkPronto({ plan: "torque-v8", seats: 6, cycle: "annual", manual: 170000, reason: "negociado" });
    await run(token);
    const [params] = gateway.createSubscription.mock.calls[0];
    const total = params.items.reduce((a: number, i: { quantity: number; price_data: { unit_amount: number } }) => a + i.quantity * i.price_data.unit_amount, 0);
    expect(total).toBe(amountCents);
  });
});

describe("critério 2: recarregar reusa", () => {
  it("mesma assinatura, mesmo secret, nada novo na Stripe", async () => {
    const { token } = await linkPronto();
    const a = await run(token);
    const b = await run(token);
    expect(b).toEqual(a);
    expect(gateway.createSubscription).toHaveBeenCalledTimes(1);
    expect(gateway.createCustomer).toHaveBeenCalledTimes(1);
  });
});

describe("ciclo da tentativa", () => {
  it.each(["incomplete_expired", "canceled"])("%s: nova tentativa com chave nova", async (estado) => {
    const { token, linkId } = await linkPronto();
    await run(token);
    subs.set("sub_1", { ...subs.get("sub_1")!, status: estado });
    const b = await run(token);
    expect(b.status).toBe(200);
    expect(gateway.createSubscription.mock.calls[1][1]).toBe(`torque:sub:${linkId}:2:${RECURRING_CONSENT_VERSION}`);
    expect((await one(db, "SELECT provider_subscription_id s, attempt FROM public.payment_link_charges WHERE payment_link_id=$1", [linkId]))).toEqual({ s: "sub_2", attempt: 2 });
  });

  it.each(["active", "past_due", "unpaid"])("%s: already_paid", async (estado) => {
    const { token } = await linkPronto();
    await run(token);
    subs.set("sub_1", { ...subs.get("sub_1")!, status: estado });
    expect(await run(token)).toEqual({ status: 200, body: { state: "already_paid" } });
    expect(gateway.createSubscription).toHaveBeenCalledTimes(1);
  });
});

describe("recusas", () => {
  it("token desconhecido", async () => {
    expect(await run("tq_pay_naoexiste")).toEqual({ status: 200, body: { state: "link_not_found" } });
  });
  it("expirado, revogado, pago", async () => {
    const e = await linkPronto();
    await db.query("UPDATE public.payment_links SET expires_at = now() - interval '1 day' WHERE id=$1", [e.linkId]);
    expect((await run(e.token)).body).toEqual({ state: "link_expired" });
    const r = await linkPronto();
    await db.query("UPDATE public.payment_links SET revoked_at = now() WHERE id=$1", [r.linkId]);
    expect((await run(r.token)).body).toEqual({ state: "link_revoked" });
    const p = await linkPronto();
    await db.query("UPDATE public.payment_links SET paid_at = now() WHERE id=$1", [p.linkId]);
    expect((await run(p.token)).body).toEqual({ state: "already_paid" });
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });
  it("new_org: target_not_supported, nada criado", async () => {
    const { token, linkId } = await linkPronto();
    await db.query("UPDATE public.payment_links SET target_kind='new_org', organization_id=NULL, new_org_name='Nova' WHERE id=$1", [linkId]);
    expect((await run(token)).body).toEqual({ state: "target_not_supported" });
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });
  it("link de pix: target_not_supported", async () => {
    const { token, linkId } = await linkPronto();
    await db.query(`UPDATE public.payment_links SET quote = quote || '{"payment_method":"pix"}' WHERE id=$1`, [linkId]);
    expect((await run(token)).body).toEqual({ state: "target_not_supported" });
  });
  it.each([
    ["tax_id_invalid", { ...BUYER, tax_id: "123" }],
    ["email_invalid", { ...BUYER, email: "sem-arroba" }],
    ["legal_name_missing", { ...BUYER, legal_name: "   " }],
  ])("%s sem criar nada na Stripe", async (estado, buyer) => {
    const { token } = await linkPronto();
    expect((await run(token, buyer)).body).toEqual({ state: estado });
    expect(gateway.createCustomer).not.toHaveBeenCalled();
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });
  it("Stripe recusa o documento: tax_id_invalid, sem assinatura", async () => {
    gateway.createCustomer.mockRejectedValueOnce(Object.assign(new Error("Invalid value 11222333000181"), { code: "tax_id_invalid", type: "StripeInvalidRequestError" }));
    const { token } = await linkPronto();
    expect((await run(token)).body).toEqual({ state: "tax_id_invalid" });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain("11222333000181");
  });
  it("preço impossível: 500 antes de qualquer chamada à Stripe", async () => {
    const { token, linkId } = await linkPronto();
    await db.query(`UPDATE public.payment_links SET quote = quote || '{"plan_name":"pro"}' WHERE id=$1`, [linkId]);
    expect((await run(token)).status).toBe(500);
    for (const fn of Object.values(gateway)) expect(fn).not.toHaveBeenCalled();
    expect(logs[0].errorMessage).toBe("price_mismatch");
  });
});

describe("critério 8: segunda assinatura da mesma org", () => {
  it("assinatura incompleta em outro link: recusa antes de criar objeto", async () => {
    const a = await linkPronto();
    await run(a.token);
    const b = await linkPronto({ orgId: a.orgId, plan: "torque-1.0", seats: 2 });
    gateway.createCustomer.mockClear();
    gateway.createSubscription.mockClear();
    expect((await run(b.token)).body).toEqual({ state: "org_already_subscribed" });
    expect(gateway.createCustomer).not.toHaveBeenCalled();
    expect(gateway.createSubscription).not.toHaveBeenCalled();
    expect(gateway.updateCustomer).not.toHaveBeenCalled();
  });

  it("assinatura corrente da org: recusa (provedor qualquer)", async () => {
    const { orgId, token } = await linkPronto();
    const { id: plan } = await one(db, "SELECT id FROM public.subscription_plans WHERE name='torque-v8'");
    await db.query("INSERT INTO public.org_subscriptions (organization_id, plan_id, billing_cycle, provider) VALUES ($1,$2,'monthly','asaas')", [orgId, plan]);
    expect((await run(token)).body).toEqual({ state: "org_already_subscribed" });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it("controle positivo: tentativa anterior expirada em outro link não barra", async () => {
    const a = await linkPronto();
    await run(a.token);
    subs.set("sub_1", { ...subs.get("sub_1")!, status: "incomplete_expired" });
    const b = await linkPronto({ orgId: a.orgId });
    expect((await run(b.token)).body).toMatchObject({ state: "ready" });
    // Customer da org é reusado.
    expect(gateway.createCustomer).toHaveBeenCalledTimes(1);
  });

  it("controle positivo: org alheia não interfere", async () => {
    const a = await linkPronto();
    await run(a.token);
    const b = await linkPronto();
    gateway.createCustomer.mockResolvedValueOnce("cus_da_outra_org");
    expect((await run(b.token)).body).toMatchObject({ state: "ready" });
  });
});

describe("N2: incompleta de link revogado não trava a org", () => {
  it("cancela a incompleta do link revogado e segue", async () => {
    const a = await linkPronto();
    await run(a.token);
    await db.query("UPDATE public.payment_links SET revoked_at=now() WHERE id=$1", [a.linkId]);
    const b = await linkPronto({ orgId: a.orgId });
    expect((await run(b.token)).body).toMatchObject({ state: "ready" });
    expect(gateway.cancelSubscription).toHaveBeenCalledWith("sub_1");
    expect(logs.some((l) => l.action === "checkout_incompleta_de_link_revogado_cancelada")).toBe(true);
  });
  it("controle: incompleta de link vivo continua barrando", async () => {
    const a = await linkPronto();
    await run(a.token);
    const b = await linkPronto({ orgId: a.orgId });
    expect((await run(b.token)).body).toEqual({ state: "org_already_subscribed" });
    expect(gateway.cancelSubscription).not.toHaveBeenCalled();
  });
  it("assinatura paga em link revogado não é cancelada: barra", async () => {
    const a = await linkPronto();
    await run(a.token);
    subs.set("sub_1", { ...subs.get("sub_1")!, status: "active" });
    await db.query("UPDATE public.payment_links SET revoked_at=now() WHERE id=$1", [a.linkId]);
    const b = await linkPronto({ orgId: a.orgId });
    expect((await run(b.token)).body).toEqual({ state: "org_already_subscribed" });
    expect(gateway.cancelSubscription).not.toHaveBeenCalled();
  });
});

describe("B2: consentimento de recorrência", () => {
  it.each([
    ["ausente", null],
    ["não aceito", { accepted: false, version: RECURRING_CONSENT_VERSION }],
    ["versão divergente", { accepted: true, version: "versao-antiga" }],
  ])("%s: consent_required, sem nenhuma chamada à Stripe e sem gravar comprador", async (_n, consent) => {
    const { token, linkId } = await linkPronto();
    expect((await run(token, BUYER, consent)).body).toEqual({ state: "consent_required", consent_version: RECURRING_CONSENT_VERSION });
    for (const fn of Object.values(gateway)) expect(fn).not.toHaveBeenCalled();
    expect(await all(db, "SELECT 1 FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId])).toHaveLength(0);
  });
  it("vem depois do passo 1: link inválido responde o estado do link", async () => {
    expect((await run("tq_pay_nao", BUYER, null)).body).toEqual({ state: "link_not_found" });
  });
  it("grava versão e data antes de criar o Customer", async () => {
    const { token, linkId } = await linkPronto();
    let consentNoCustomer: unknown = null;
    gateway.createCustomer.mockImplementationOnce(async () => {
      consentNoCustomer = (await one(db, "SELECT recurring_consent_version v FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId])).v;
      return "cus_novo";
    });
    await run(token);
    expect(consentNoCustomer).toBe(RECURRING_CONSENT_VERSION);
    const r = await one(db, "SELECT recurring_consent_at IS NOT NULL a FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId]);
    expect(r.a).toBe(true);
  });
  it("falha ao gravar o consentimento: 500 sem objeto na Stripe", async () => {
    const { token } = await linkPronto();
    await db.exec("ALTER FUNCTION public.billing_stripe_record_consent(uuid, text) RENAME TO fora_do_ar");
    expect((await run(token)).status).toBe(500);
    expect(gateway.createCustomer).not.toHaveBeenCalled();
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });
  it("incompleta criada em versão anterior: metadata atualizada no reuso", async () => {
    const { token } = await linkPronto();
    await run(token);
    subs.set("sub_1", { ...subs.get("sub_1")!, consentVersion: "versao-antiga" });
    const b = await run(token);
    expect(b.body).toMatchObject({ state: "ready" });
    expect(gateway.updateSubscriptionMetadata).toHaveBeenCalledWith("sub_1", { torque_consent_version: RECURRING_CONSENT_VERSION });
    expect(gateway.createSubscription).toHaveBeenCalledTimes(1);
  });
  it("mesma versão no reuso: nada a atualizar", async () => {
    const { token } = await linkPronto();
    await run(token);
    await run(token);
    expect(gateway.updateSubscriptionMetadata).not.toHaveBeenCalled();
  });
});

describe("corridas e estados tardios", () => {
  it("link revogado com a assinatura já criada: cancela e recusa", async () => {
    const { token, linkId } = await linkPronto();
    gateway.createSubscription.mockImplementationOnce(async () => {
      await db.query("UPDATE public.payment_links SET revoked_at = now() WHERE id=$1", [linkId]);
      return novaAssinatura();
    });
    expect((await run(token)).body).toEqual({ state: "link_revoked" });
    expect(gateway.cancelSubscription).toHaveBeenCalledWith("sub_1");
    expect(logs.some((l) => l.action === "checkout_assinatura_cancelada" && l.status === "error")).toBe(true);
  });

  it("duas abas com Customer: o primeiro ponteiro vence", async () => {
    const { token, orgId } = await linkPronto();
    gateway.createCustomer.mockImplementationOnce(async () => {
      await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe','cus_vencedor',false)", [orgId]);
      return "cus_perdedor";
    });
    await run(token);
    expect(gateway.createSubscription.mock.calls[0][0].customer).toBe("cus_vencedor");
  });

  it("Customer de outro modo: 500, não mistura test com live", async () => {
    const { token, orgId } = await linkPronto();
    await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe','cus_live',true)", [orgId]);
    expect((await run(token)).status).toBe(500);
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  it("N4: documento trocado: cria o novo antes de apagar os antigos, sem logar o valor", async () => {
    const { token, orgId } = await linkPronto();
    await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe','cus_x',false)", [orgId]);
    gateway.listCustomerTaxIds.mockResolvedValueOnce([{ id: "txi_a", value: "99.999.999/0001-91" }, { id: "txi_b", value: "111.444.777-35" }]);
    await run(token);
    expect(gateway.updateCustomer).toHaveBeenCalledWith("cus_x", { name: "Empresa Real LTDA", email: "comprador@empresa.com.br" });
    expect(gateway.createCustomerTaxId).toHaveBeenCalledWith("cus_x", { type: "br_cnpj", value: "11.222.333/0001-81" });
    expect(gateway.deleteCustomerTaxId.mock.calls).toEqual([["cus_x", "txi_a"], ["cus_x", "txi_b"]]);
    expect(gateway.createCustomerTaxId.mock.invocationCallOrder[0]).toBeLessThan(gateway.deleteCustomerTaxId.mock.invocationCallOrder[0]);
    expect(logs.some((l) => l.action === "checkout_documento_trocado")).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/99\.999|11222333|111\.444/);
  });

  it("N4: documento igual não toca no Customer além de nome e e-mail", async () => {
    const { token, orgId } = await linkPronto();
    await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe','cus_x',false)", [orgId]);
    await run(token);
    expect(gateway.createCustomerTaxId).not.toHaveBeenCalled();
    expect(gateway.deleteCustomerTaxId).not.toHaveBeenCalled();
  });

  it("N4: Stripe recusa o documento novo: tax_id_invalid, antigos ficam, sem assinatura", async () => {
    const { token, orgId } = await linkPronto();
    await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe','cus_x',false)", [orgId]);
    gateway.listCustomerTaxIds.mockResolvedValueOnce([{ id: "txi_a", value: "99.999.999/0001-91" }]);
    gateway.createCustomerTaxId.mockRejectedValueOnce(Object.assign(new Error("Invalid"), { code: "tax_id_invalid" }));
    expect((await run(token)).body).toEqual({ state: "tax_id_invalid" });
    expect(gateway.deleteCustomerTaxId).not.toHaveBeenCalled();
    expect(gateway.createSubscription).not.toHaveBeenCalled();
  });

  describe("N8: documento converge", () => {
    const comCustomer = async () => {
      const l = await linkPronto();
      await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe','cus_x',false)", [l.orgId]);
      return l;
    };
    const ATUAL = { id: "txi_atual", value: "11.222.333/0001-81" };
    const VELHO = { id: "txi_velho", value: "99.999.999/0001-91" };

    it("corrida deixou dois documentos: apaga o diferente sem criar", async () => {
      const { token } = await comCustomer();
      gateway.listCustomerTaxIds.mockResolvedValueOnce([ATUAL, VELHO]);
      expect((await run(token)).body).toMatchObject({ state: "ready" });
      expect(gateway.createCustomerTaxId).not.toHaveBeenCalled();
      expect(gateway.deleteCustomerTaxId.mock.calls).toEqual([["cus_x", "txi_velho"]]);
    });

    it("delete falho: 500, sem assinatura, e o POST seguinte converge", async () => {
      const { token } = await comCustomer();
      gateway.listCustomerTaxIds.mockResolvedValueOnce([VELHO]);
      gateway.deleteCustomerTaxId.mockRejectedValueOnce(Object.assign(new Error("x"), { type: "StripeAPIError" }));
      expect((await run(token)).status).toBe(500);
      expect(gateway.createCustomerTaxId).toHaveBeenCalledTimes(1);
      expect(gateway.createSubscription).not.toHaveBeenCalled();

      gateway.listCustomerTaxIds.mockResolvedValueOnce([ATUAL, VELHO]);
      expect((await run(token)).body).toMatchObject({ state: "ready" });
      expect(gateway.createCustomerTaxId).toHaveBeenCalledTimes(1);
      expect(gateway.deleteCustomerTaxId).toHaveBeenLastCalledWith("cus_x", "txi_velho");
    });

    it("delete de id que outra aba já apagou é tolerado", async () => {
      const { token } = await comCustomer();
      gateway.listCustomerTaxIds.mockResolvedValueOnce([ATUAL, VELHO]);
      gateway.deleteCustomerTaxId.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "resource_missing" }));
      expect((await run(token)).body).toMatchObject({ state: "ready" });
    });

    it("create que perde a corrida para outra aba é tolerado e ainda apaga os antigos", async () => {
      const { token } = await comCustomer();
      gateway.listCustomerTaxIds.mockResolvedValueOnce([VELHO]);
      gateway.createCustomerTaxId.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "resource_already_exists" }));
      expect((await run(token)).body).toMatchObject({ state: "ready" });
      expect(gateway.deleteCustomerTaxId).toHaveBeenCalledWith("cus_x", "txi_velho");
    });

    it("falha ao criar mantém os antigos", async () => {
      const { token } = await comCustomer();
      gateway.listCustomerTaxIds.mockResolvedValueOnce([VELHO]);
      gateway.createCustomerTaxId.mockRejectedValueOnce(Object.assign(new Error("x"), { type: "StripeAPIError" }));
      expect((await run(token)).status).toBe(500);
      expect(gateway.deleteCustomerTaxId).not.toHaveBeenCalled();
      expect(gateway.createSubscription).not.toHaveBeenCalled();
    });
  });

  describe("janela de webhook atrasado", () => {
    it.each(["active", "past_due", "unpaid"])("assinatura %s com link ainda sem paid_at: already_paid sem tocar Customer nem comprador", async (estado) => {
      const { token, linkId } = await linkPronto();
      await run(token);
      subs.set("sub_1", { ...subs.get("sub_1")!, status: estado });
      gateway.updateCustomer.mockClear();
      gateway.listCustomerTaxIds.mockClear();
      const antes = await one(db, "SELECT email, tax_id FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId]);

      const outro = { legal_name: "Outra", email: "outro@empresa.com.br", tax_id: "11444777000161" };
      expect((await run(token, outro)).body).toEqual({ state: "already_paid" });

      expect(gateway.updateCustomer).not.toHaveBeenCalled();
      expect(gateway.listCustomerTaxIds).not.toHaveBeenCalled();
      expect(gateway.createCustomerTaxId).not.toHaveBeenCalled();
      expect(await one(db, "SELECT email, tax_id FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId])).toEqual(antes);
    });

    it("controle positivo: incompleta ainda troca o documento", async () => {
      const { token } = await linkPronto();
      await run(token);
      gateway.listCustomerTaxIds.mockResolvedValueOnce([{ id: "txi_1", value: "11.222.333/0001-81" }]);
      expect((await run(token, { ...BUYER, tax_id: "11444777000161" })).body).toMatchObject({ state: "ready" });
      expect(gateway.createCustomerTaxId).toHaveBeenCalledWith("cus_novo", { type: "br_cnpj", value: "11.444.777/0001-61" });
    });

    it("B2 intacto: sem consentimento, a recusa vem antes de consultar a assinatura", async () => {
      const { token } = await linkPronto();
      await run(token);
      gateway.retrieveSubscription.mockClear();
      expect((await run(token, BUYER, null)).body).toMatchObject({ state: "consent_required" });
      expect(gateway.retrieveSubscription).not.toHaveBeenCalled();
    });
  });

  it("N3: link pago na corrida, mesma assinatura: already_paid sem cancelar", async () => {
    const { token, linkId } = await linkPronto();
    await db.query("INSERT INTO public.payment_link_charges (payment_link_id, method, provider, provider_charge_id, provider_subscription_id, attempt) VALUES ($1,'credit_card','stripe','in_old','sub_old',0)", [linkId]);
    subs.set("sub_old", { ...novaAssinatura(), id: "sub_old", status: "incomplete_expired" });
    gateway.createSubscription.mockImplementationOnce(async () => {
      await db.query("UPDATE public.payment_links SET paid_at=now() WHERE id=$1", [linkId]);
      await db.query("UPDATE public.payment_link_charges SET provider_subscription_id='sub_mesma', provider_charge_id='in_mesma' WHERE payment_link_id=$1", [linkId]);
      return { ...novaAssinatura(), id: "sub_mesma", latestInvoiceId: "in_mesma" };
    });
    expect((await run(token)).body).toEqual({ state: "already_paid" });
    expect(gateway.cancelSubscription).not.toHaveBeenCalled();
  });

  it("renovação paga depois do checkout: link pago recusa", async () => {
    const { token, orgId, amountCents } = await linkPronto();
    await run(token);
    await rpcAdapter(db)("billing_stripe_apply_invoice_paid", paidArgs(await seedEvent(db), { invoice: "in_1", sub: "sub_1", amount: amountCents }));
    expect((await run(token)).body).toEqual({ state: "already_paid" });
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [orgId])).toHaveLength(1);
  });
});

describe("critério 10: nada sensível em log nem resposta de erro", () => {
  it("token, secret, e-mail e documento fora dos logs do caminho feliz e do erro", async () => {
    const { token } = await linkPronto();
    await run(token);
    await run(token);
    gateway.createCustomer.mockRejectedValueOnce(Object.assign(new Error(`falhou para ${BUYER.email}`), { type: "StripeAPIError" }));
    const outro = await linkPronto();
    const r = await run(outro.token);
    expect(r.status).toBe(500);
    const texto = JSON.stringify({ logs, r });
    for (const v of [token, outro.token, SECRET_OF("sub_1"), "comprador@empresa", BUYER.email.trim(), "11222333000181", "Empresa Real"]) {
      expect(texto).not.toContain(v);
    }
  });

  it("metadata não leva PII nem token", async () => {
    const { token } = await linkPronto();
    await run(token);
    const texto = JSON.stringify(gateway.createSubscription.mock.calls[0]) ;
    for (const v of [token, "comprador", "11222333"]) expect(texto).not.toContain(v);
  });
});

describe("freio", () => {
  const rpcOk = vi.fn(async () => ({ data: true, error: null }));
  it("chave do balde deriva do token e não o contém", async () => {
    const k = await rateLimitKey("tq_pay_abc");
    expect(k).toHaveLength(32);
    expect(k).not.toContain("tq_pay");
  });
  it("dentro do teto passa; usa 10/5min por token e 30/5min por IP", async () => {
    expect(await withinRateLimit(rpcOk, "t", "1.1.1.1", async () => undefined)).toBe(true);
    const chamadas = rpcOk.mock.calls.map((c) => (c as unknown as [string, Record<string, unknown>])[1]);
    expect(chamadas.map((a) => a.p_max)).toEqual([10, 30]);
    expect(chamadas.every((a) => a.p_window === "5 minutes")).toBe(true);
    expect(chamadas.some((a) => a.p_ip === "t")).toBe(false);
  });
  it("estourou qualquer um: recusa", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await withinRateLimit(rpc, "t", "1", async () => undefined)).toBe(false);
  });
  it("freio quebrado: falha fechada e registra", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "caiu" } });
    const logEntries: CheckoutLogEntry[] = [];
    expect(await withinRateLimit(rpc, "t", "1", async (e) => { logEntries.push(e); })).toBe(false);
    expect(logEntries[0]).toMatchObject({ status: "error", payloadSnapshot: { fail_closed: true } });
  });
});

describe("entrada", () => {
  it("corpo só aceita token e comprador; preço no corpo é ignorado", () => {
    const p = parseCheckoutInput({ token: "t", buyer: BUYER, consent: CONSENT, amount_cents: 1, plan_id: "x", organization_id: "y" });
    expect(p).toEqual({ token: "t", buyer: BUYER, consent: CONSENT });
  });
  it.each([[undefined], ["sim"], [{ accepted: "true", version: "v" }], [{ accepted: true }], [{ accepted: true, version: 1 }]])("consentimento malformado %j vira null, não 400", (consent) => {
    expect(parseCheckoutInput({ token: "t", buyer: BUYER, consent })).toEqual({ token: "t", buyer: BUYER, consent: null });
  });
  it.each([[null], [{}], [{ token: 1, buyer: BUYER }], [{ token: "t" }], [{ token: "t", buyer: { ...BUYER, email: 5 } }], [{ token: "x".repeat(201), buyer: BUYER }]])("recusa %j", (b) => {
    expect(parseCheckoutInput(b)).toBeNull();
  });
  it.each([
    ["11222333000181", true], ["11444777000161", true], ["11144477735", true], ["52998224725", true],
    ["12345678901234", false], ["11222333000182", false], ["11144477736", false],
    ["00000000000000", false], ["11111111111", false], ["123", false], ["", false],
  ])("dígitos verificadores de %s: %s", (doc, esperado) => {
    expect(isValidBrTaxId(doc)).toBe(esperado);
  });
  it("documento com DV errado para antes da Stripe", async () => {
    const { token } = await linkPronto();
    expect((await run(token, { ...BUYER, tax_id: "12.345.678/9012-34" })).body).toEqual({ state: "tax_id_invalid" });
    expect(gateway.createCustomer).not.toHaveBeenCalled();
  });
  it("formata documento", () => {
    expect(stripeTaxId("11222333000181")).toEqual({ type: "br_cnpj", value: "11.222.333/0001-81" });
    expect(stripeTaxId("11144477735")).toEqual({ type: "br_cpf", value: "111.444.777-35" });
  });
});

describe("Q7: token que o banco não aceita", () => {
  it.each(["\u0000", "tq_pay_\u0000x", "abc def", "x\ny"])("%j vira link_not_found sem falar com o banco", async (token) => {
    const spy = vi.fn(async () => ({ data: null, error: { code: "22021", message: "invalid byte" } }));
    const r = await runCheckout({ token, buyer: BUYER, consent: CONSENT }, { ...deps(), db: { ...deps().db, resolveLink: spy } });
    expect(r).toEqual({ status: 200, body: { state: "link_not_found" } });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Q4: comprador mudou com incompleta viva", () => {
  const TROCADO = { ...BUYER, tax_id: "11444777000161" };

  it("mesmo comprador: reusa, sem anular nada", async () => {
    const { token } = await linkPronto();
    await run(token);
    await run(token);
    expect(gateway.voidInvoice).not.toHaveBeenCalled();
    expect(gateway.createSubscription).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["documento", TROCADO],
    ["nome", { ...BUYER, legal_name: "Outra LTDA" }],
    ["e-mail", { ...BUYER, email: "outro@empresa.com.br" }],
  ])("%s diferente: anula a fatura, cancela e cria attempt+1 com secret novo", async (_campo, buyer) => {
    const { token, linkId } = await linkPronto();
    const primeira = await run(token);
    const segunda = await run(token, buyer);
    expect(gateway.voidInvoice).toHaveBeenCalledTimes(1);
    expect(gateway.voidInvoice).toHaveBeenCalledWith("in_1");
    expect(gateway.cancelSubscription).toHaveBeenCalledWith("sub_1");
    expect(gateway.voidInvoice.mock.invocationCallOrder[0]).toBeLessThan(gateway.cancelSubscription.mock.invocationCallOrder[0]);
    expect((segunda.body as { client_secret: string }).client_secret).not.toBe((primeira.body as { client_secret: string }).client_secret);
    const row = await one(db, "SELECT attempt FROM public.payment_link_charges WHERE payment_link_id=$1", [linkId]);
    expect((row as { attempt: number }).attempt).toBe(2);
  });

  it("a anulação vem ANTES de mexer em comprador e Customer: paga na corrida não toca em nada", async () => {
    const { token, linkId } = await linkPronto();
    await run(token);
    gateway.voidInvoice.mockImplementation(async () => "paid");
    gateway.updateCustomer.mockClear();
    gateway.createSubscription.mockClear();
    const r = await run(token, TROCADO);
    expect(r.body).toEqual({ state: "already_paid" });
    expect(gateway.cancelSubscription).not.toHaveBeenCalled();
    expect(gateway.createSubscription).not.toHaveBeenCalled();
    expect(gateway.updateCustomer).not.toHaveBeenCalled();
    const b = await one(db, "SELECT tax_id FROM public.payment_link_buyers WHERE payment_link_id=$1", [linkId]);
    expect((b as { tax_id: string }).tax_id).toBe("11222333000181");
  });

  it("assinatura antiga, sem hash na metadata: reusa, não anula às cegas", async () => {
    const { token } = await linkPronto();
    await run(token);
    for (const s of subs.values()) s.buyerHash = null;
    await run(token, TROCADO);
    expect(gateway.voidInvoice).not.toHaveBeenCalled();
  });
});

describe("N2: anulação feita e cancelamento que falhou", () => {
  it("o POST seguinte repete a anulação, cancela e segue com attempt+1", async () => {
    const { token, linkId } = await linkPronto();
    await run(token);
    gateway.cancelSubscription.mockImplementationOnce(async () => { throw Object.assign(new Error("rede"), { code: "api_connection_error" }); });
    const falha = await run(token, { ...BUYER, legal_name: "Outra LTDA" });
    expect(falha.status).toBe(500);
    // Fatura anulada não tem mais confirmation_secret; a assinatura segue incompleta.
    subs.set("sub_1", { ...subs.get("sub_1")!, clientSecret: null });

    const r = await run(token, { ...BUYER, legal_name: "Outra LTDA" });
    expect((r.body as { state: string }).state).toBe("ready");
    expect(gateway.voidInvoice).toHaveBeenCalledTimes(2);
    expect(gateway.cancelSubscription).toHaveBeenCalledTimes(2);
    const row = await one(db, "SELECT attempt, provider_subscription_id s FROM public.payment_link_charges WHERE payment_link_id=$1", [linkId]);
    expect(row).toEqual({ attempt: 2, s: "sub_2" });
  });

  it("mesmo sem troca de comprador, incompleta sem secret não trava o link", async () => {
    const { token } = await linkPronto();
    await run(token);
    subs.set("sub_1", { ...subs.get("sub_1")!, clientSecret: null });
    const r = await run(token);
    expect((r.body as { state: string }).state).toBe("ready");
    expect(gateway.voidInvoice).toHaveBeenCalledWith("in_1");
  });

  it("incompleta sem secret com a fatura paga: already_paid, sem cancelar", async () => {
    const { token } = await linkPronto();
    await run(token);
    subs.set("sub_1", { ...subs.get("sub_1")!, clientSecret: null });
    gateway.voidInvoice.mockImplementation(async () => "paid");
    expect((await run(token)).body).toEqual({ state: "already_paid" });
    expect(gateway.cancelSubscription).not.toHaveBeenCalled();
  });
});

describe("Q6: perdedor da corrida do Customer", () => {
  it("documento diferente: converge para o atual no vencedor e apaga o órfão", async () => {
    const { token, orgId } = await linkPronto();
    gateway.createCustomer.mockImplementation(async () => {
      await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe','cus_vencedor',false)", [orgId]);
      return "cus_perdedor";
    });
    gateway.listCustomerTaxIds.mockImplementation(async () => [{ id: "txi_antigo", value: "11.444.777/0001-61" }]);
    const r = await run(token);
    expect((r.body as { state: string }).state).toBe("ready");
    expect(gateway.updateCustomer).toHaveBeenCalledWith("cus_vencedor", { name: "Empresa Real LTDA", email: "comprador@empresa.com.br" });
    expect(gateway.createCustomerTaxId).toHaveBeenCalledWith("cus_vencedor", { type: "br_cnpj", value: "11.222.333/0001-81" });
    expect(gateway.deleteCustomerTaxId).toHaveBeenCalledWith("cus_vencedor", "txi_antigo");
    expect(gateway.deleteCustomer).toHaveBeenCalledWith("cus_perdedor");
    expect(gateway.createSubscription.mock.calls[0][0].customer).toBe("cus_vencedor");
  });

  it("mesma chave idempotente devolveu o MESMO Customer: não apaga", async () => {
    const { token, orgId } = await linkPronto();
    gateway.createCustomer.mockImplementation(async () => {
      await db.query("INSERT INTO public.org_billing_customers (organization_id, provider, provider_customer_id, livemode) VALUES ($1,'stripe','cus_igual',false)", [orgId]);
      return "cus_igual";
    });
    await run(token);
    expect(gateway.deleteCustomer).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
/**
 * Handler do webhook com o SDK real (assinatura local), eventos reais capturados em
 * modo teste na F0 (tests/fixtures/stripe/captured-events.json) e banco real (PGlite).
 * Critérios 4, 5, 10 e 11.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";
import {
  all, attach, createBillingDb, one, rpcAdapter, seedLink, seedOrg, webhookDbAdapter,
} from "../helpers/stripe-billing-pglite.mjs";
import { handleStripeWebhook, type WebhookDeps, type WebhookLogEntry } from "../../supabase/functions/stripe-webhook/handler.ts";
import { createStripeSdk, stripeErrorInfo, verifyStripeWebhook, STRIPE_API_VERSION } from "../../supabase/functions/_shared/stripe/client.ts";
import { projectSubscription, projectInvoice, eventLedgerPayload, type StripeEventLike, type SubscriptionView } from "../../supabase/functions/_shared/stripe/events.ts";
import { readStripeConfig } from "../../supabase/functions/_shared/stripe/env.ts";

const CAPTURADOS: StripeEventLike[] = JSON.parse(
  readFileSync(new URL("../fixtures/stripe/captured-events.json", import.meta.url), "utf8"),
);
const SECRET = ["whsec", "local", "fixture"].join("_");
const KEY = ["sk", "test", "fixture"].join("_");
const sdk = createStripeSdk(KEY);

let base: PGlite;
let db: PGlite;
let logs: WebhookLogEntry[];
let subs: Map<string, SubscriptionView>;

const config = () => readStripeConfig((k) => ({ STRIPE_ENV: "test", STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET } as Record<string, string>)[k]);

function deps(over: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    config: config(),
    verify: (raw, sig) => verifyStripeWebhook(sdk, raw, sig, SECRET),
    retrieveSubscription: async (id) => {
      const s = subs.get(id);
      if (!s) throw Object.assign(new Error("No such subscription"), { type: "StripeInvalidRequestError", code: "resource_missing" });
      return s;
    },
    describeError: stripeErrorInfo,
    ...webhookDbAdapter(db),
    log: async (e) => { logs.push(e); },
    ...over,
  };
}

function assinar(event: unknown, secret = SECRET, timestamp?: number) {
  const rawBody = JSON.stringify(event);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret, timestamp });
  return { rawBody, signature };
}

const entregar = (event: unknown, d?: Partial<WebhookDeps>) => handleStripeWebhook(assinar(event), deps(d));

beforeAll(async () => { base = await createBillingDb(); }, 60_000);
beforeEach(async () => {
  db = await base.clone();
  logs = [];
  subs = new Map();
});
afterEach(async () => { await db.close(); });

// Eventos do cenário A da F0: primeira invoice, renovação, renovação falha, cancelamento.
const subA = CAPTURADOS.find((e) => e.type === "customer.subscription.created")!;
const idA = (subA.data.object as { id: string }).id;
const doA = (t: string) => CAPTURADOS.filter((e) => {
  if (e.type !== t) return false;
  const o = e.data.object as Record<string, unknown>;
  if (t.startsWith("invoice.")) return projectInvoice(o).subscriptionId === idA;
  return o.id === idA;
});
const [paid1, paid2] = doA("invoice.paid");
const failed = doA("invoice.payment_failed")[0];
const deleted = doA("customer.subscription.deleted")[0];
const invoiceId = (e: StripeEventLike) => (e.data.object as { id: string }).id;

/** Link com o valor que os eventos capturados pagaram (R$ 1.997,00 mensal, torque-v8). */
async function preparar(opts: { status?: string } = {}) {
  const org = await seedOrg(db, opts);
  const link = await seedLink(db, { orgId: org, plan: "torque-v8", seats: 3, cycle: "monthly" });
  await attach(db, { linkId: link.linkId, sub: idA, invoice: invoiceId(paid1) });
  subs.set(idA, { ...projectSubscription(subA.data.object), status: "active" });
  return { org, link };
}

const ledger = () => all(db, "SELECT provider_event_id, status, error_message FROM public.payment_webhook_events ORDER BY received_at");
const provisionar = async (pagamento: string) => (await rpcAdapter(db)("billing_provision_existing_org", { p_provider_payment_id: pagamento })).data;

describe("sanidade das fixtures", () => {
  it("eventos reais, com a versão de API do SDK pinado", () => {
    expect(CAPTURADOS.length).toBeGreaterThan(10);
    expect(new Set(CAPTURADOS.map((e) => e.api_version))).toEqual(new Set([STRIPE_API_VERSION]));
    expect(paid1 && paid2 && failed && deleted).toBeTruthy();
  });
  it("sem PII nem segredo", () => {
    const texto = JSON.stringify(CAPTURADOS);
    for (const proibido of ["@", "_secret_", "sk_test", "whsec_", "hosted_invoice_url", "invoice_pdf", "customer_email", "customer_tax_ids"]) {
      expect(texto).not.toContain(proibido);
    }
  });
  it("período vem das linhas: na renovação, invoice.period_end é o ciclo anterior", () => {
    const o = paid2.data.object as { period_end: number };
    const p = projectInvoice(paid2.data.object);
    expect(new Date(p.periodEnd!).getTime()).toBeGreaterThan(o.period_end * 1000);
    expect(p.billingReason).toBe("subscription_cycle");
    expect(p.subscriptionId).toBe(idA);
  });
});

describe("portas de entrada", () => {
  it("assinatura válida passa; corpo adulterado, segredo errado, sem cabeçalho e fora da tolerância dão 400", async () => {
    await preparar();
    const ok = assinar(paid1);
    const ruins = [
      { rawBody: ok.rawBody.replace("199700", "199701"), signature: ok.signature },
      assinar(paid1, ["whsec", "outro"].join("_")),
      { rawBody: ok.rawBody, signature: null },
      assinar(paid1, SECRET, Math.floor(Date.now() / 1000) - 301),
    ];
    for (const r of ruins) {
      const res = await handleStripeWebhook(r, deps());
      expect(res).toEqual({ status: 400, body: { error: "invalid_signature" } });
    }
    expect(await ledger()).toEqual([]);
    // N5: varredura com assinatura inválida não enche runtime_logs.
    expect(logs).toEqual([]);
    expect((await handleStripeWebhook(ok, deps())).status).toBe(200);
  });

  it("evento em livemode divergente: 400, nada gravado", async () => {
    const res = await entregar({ ...paid1, livemode: true });
    expect(res).toEqual({ status: 400, body: { error: "livemode_mismatch" } });
    expect(await ledger()).toEqual([]);
  });

  it("critério 11: configuração divergente responde 503 sem verificar nem falar com a Stripe", async () => {
    const verify = vi.fn();
    const retrieveSubscription = vi.fn();
    for (const e of [
      { STRIPE_ENV: "live", STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET },
      { STRIPE_ENV: "test", STRIPE_SECRET_KEY: KEY },
      { STRIPE_ENV: "x", STRIPE_SECRET_KEY: KEY, STRIPE_WEBHOOK_SECRET: SECRET },
    ] as Record<string, string>[]) {
      const res = await handleStripeWebhook(assinar(paid1), deps({ config: readStripeConfig((k) => e[k]), verify, retrieveSubscription }));
      expect(res).toEqual({ status: 503, body: { error: "billing_not_configured" } });
    }
    expect(verify).not.toHaveBeenCalled();
    expect(retrieveSubscription).not.toHaveBeenCalled();
    expect(await ledger()).toEqual([]);
  });

  it("tipo desconhecido: absorve como unknown_type, 200", async () => {
    const res = await entregar({ ...paid1, id: "evt_novo", type: "charge.dispute.created" });
    expect(res.status).toBe(200);
    expect(await ledger()).toEqual([{ provider_event_id: "evt_novo", status: "unknown_type", error_message: null }]);
  });
});

describe("invoice.paid", () => {
  it("critério 5: primeira invoice e renovação reais", async () => {
    const { org } = await preparar();
    expect((await entregar(paid1)).status).toBe(200);
    await provisionar(invoiceId(paid1));
    const o1 = await one(db, "SELECT subscription_status s, subscription_expires_at e FROM public.organizations WHERE id=$1", [org]);
    expect(o1.s).toBe("active");
    expect(new Date(o1.e).toISOString()).toBe(projectInvoice(paid1.data.object).periodEnd);

    expect((await entregar(paid2)).status).toBe(200);
    await provisionar(invoiceId(paid2));
    const o2 = await one(db, "SELECT subscription_expires_at e FROM public.organizations WHERE id=$1", [org]);
    expect(new Date(o2.e).toISOString()).toBe(projectInvoice(paid2.data.object).periodEnd);
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [org])).toHaveLength(2);
    expect(await all(db, "SELECT 1 FROM public.subscription_provisionings WHERE organization_id=$1", [org])).toHaveLength(2);
  });

  it("critério 4: reentrega não duplica", async () => {
    const { org } = await preparar();
    await entregar(paid1);
    const res = await entregar(paid1);
    expect(res).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [org])).toHaveLength(1);
    expect(await all(db, "SELECT 1 FROM public.payment_webhook_events")).toHaveLength(1);
  });

  it("critério 4: fora de ordem converge ao mesmo estado final", async () => {
    const estadoFinal = async (ordem: StripeEventLike[]) => {
      const banco = await base.clone();
      const anterior = db;
      db = banco;
      const { org } = await preparar();
      for (const e of ordem) await entregar(e);
      const r = await one(db, "SELECT provider_payment_id, renews_at, provider_status FROM public.org_subscriptions WHERE organization_id=$1", [org]);
      const h = await all(db, "SELECT provider_payment_id, status FROM public.payment_history WHERE organization_id=$1 ORDER BY 1", [org]);
      db = anterior;
      await banco.close();
      return { sub: r, historico: h };
    };
    const updated = doA("customer.subscription.updated");
    const direta = await estadoFinal([paid1, ...updated, paid2]);
    const invertida = await estadoFinal([paid2, updated[updated.length - 1], paid1, ...updated.slice(0, 2)]);
    expect(direta.historico).toEqual(invertida.historico);
    expect(direta.sub.renews_at).toEqual(invertida.sub.renews_at);
    expect(direta.sub.provider_payment_id).toBe(invoiceId(paid2));
    expect(invertida.sub.provider_payment_id).toBe(invoiceId(paid2));
  });

  it("critério 4: crash no meio responde 500, fica failed e a reentrega reprocessa", async () => {
    const { org } = await preparar();
    const quebrada = await entregar(paid1, { rpc: async () => ({ data: null, error: { code: "XX000", message: "caiu" } }) });
    expect(quebrada).toEqual({ status: 500, body: { error: "processing_failed" } });
    expect((await ledger())[0]).toMatchObject({ status: "failed", error_message: "rpc:XX000" });
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(0);

    expect((await entregar(paid1)).status).toBe(200);
    expect((await ledger())[0]).toMatchObject({ status: "applied" });
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(1);
  });

  it("evento preso em received (crash entre ledger e RPC) reprocessa", async () => {
    const { org } = await preparar();
    await entregar(paid1, { retrieveSubscription: async () => { throw Object.assign(new Error("x"), { type: "StripeConnectionError" }); } });
    await db.query("UPDATE public.payment_webhook_events SET status='received'");
    expect((await entregar(paid1)).status).toBe(200);
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(1);
  });

  it("assinatura incompleta com OUTRA invoice mais nova: 500 para a Stripe reentregar", async () => {
    await preparar();
    subs.set(idA, { ...subs.get(idA)!, status: "incomplete", latestInvoiceId: "in_outra" });
    expect((await entregar(paid1)).status).toBe(500);
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions")).toHaveLength(0);
    subs.set(idA, { ...subs.get(idA)!, status: "active" });
    expect((await entregar(paid1)).status).toBe(200);
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions")).toHaveLength(1);
  });

  it.each(["incomplete", "past_due"])("N1: %s e esta é a última invoice da assinatura: aplica como active", async (estado) => {
    const { org } = await preparar();
    subs.set(idA, { ...subs.get(idA)!, status: estado, latestInvoiceId: invoiceId(paid1) });
    expect((await entregar(paid1)).status).toBe(200);
    expect(await one(db, "SELECT provider_status, provider_payment_id FROM public.org_subscriptions WHERE organization_id=$1", [org]))
      .toEqual({ provider_status: "active", provider_payment_id: invoiceId(paid1) });
  });

  it("N1: past_due com outra invoice em aberto: not_active, alarme vermelho, dinheiro registrado", async () => {
    const { org } = await preparar();
    subs.set(idA, { ...subs.get(idA)!, status: "past_due", latestInvoiceId: "in_mais_nova" });
    expect((await entregar(paid1)).status).toBe(200);
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(0);
    expect(await all(db, "SELECT 1 FROM public.payment_history WHERE organization_id=$1", [org])).toHaveLength(1);
    expect(logs.find((l) => l.action === "stripe_webhook_paga_nao_ativa")).toMatchObject({ status: "error" });
  });

  it("N1: canceled nunca vira active", async () => {
    const { org } = await preparar();
    subs.set(idA, { ...subs.get(idA)!, status: "canceled", latestInvoiceId: invoiceId(paid1) });
    expect((await entregar(paid1)).status).toBe(200);
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(0);
  });

  it("Stripe fora do ar: 500, sem o texto do erro no log", async () => {
    await preparar();
    const res = await entregar(paid1, {
      retrieveSubscription: async () => { throw Object.assign(new Error("dado sensível no texto"), { type: "StripeAPIError", code: "api_error", requestId: "req_1" }); },
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(logs)).not.toContain("dado sensível");
    expect(JSON.stringify(logs)).toContain("req_1");
  });

  it("assinatura desconhecida: 200, failed, alarme", async () => {
    subs.set(idA, { ...projectSubscription(subA.data.object), status: "active" });
    expect((await entregar(paid1)).status).toBe(200);
    expect((await ledger())[0]).toMatchObject({ status: "failed", error_message: "subscription_unknown" });
    expect(logs.some((l) => l.action === "stripe_webhook_assinatura_desconhecida" && l.status === "error")).toBe(true);
  });

  it("critério 8: conflito alarma", async () => {
    const { org } = await preparar();
    const outro = await seedLink(db, { orgId: org });
    await attach(db, { linkId: outro.linkId, sub: "sub_outra", invoice: "in_outra" });
    subs.set("sub_outra", { ...subs.get(idA)!, id: "sub_outra" });
    await entregar(paid1);
    const paidOutra = JSON.parse(JSON.stringify(paid1).replaceAll(idA, "sub_outra").replaceAll(invoiceId(paid1), "in_outra").replace(paid1.id, "evt_outra"));
    expect((await entregar(paidOutra)).status).toBe(200);
    expect(logs.some((l) => l.action === "stripe_webhook_conflito_assinatura" && l.status === "error")).toBe(true);
    expect(await all(db, "SELECT provider_subscription_id FROM public.org_subscriptions WHERE organization_id=$1", [org])).toEqual([{ provider_subscription_id: idA }]);
  });

  it("B3: link revogado pago: aplica e alarma em vermelho", async () => {
    const { org, link } = await preparar();
    await db.query("UPDATE public.payment_links SET revoked_at=now() WHERE id=$1", [link.linkId]);
    expect((await entregar(paid1)).status).toBe(200);
    expect(logs.find((l) => l.action === "stripe_webhook_paga_link_revogado")).toMatchObject({ status: "error", organizationId: org });
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(1);
  });

  it("N7: renovação real com link revogado depois de pago não alarma", async () => {
    const { link } = await preparar();
    await entregar(paid1);
    await db.query("UPDATE public.payment_links SET revoked_at=now() WHERE id=$1", [link.linkId]);
    logs.length = 0;
    expect((await entregar(paid2)).status).toBe(200);
    expect(logs.some((l) => l.action === "stripe_webhook_paga_link_revogado")).toBe(false);
  });

  it("B3: controle positivo: link vivo não alarma", async () => {
    await preparar();
    await entregar(paid1);
    expect(logs.some((l) => l.action === "stripe_webhook_paga_link_revogado")).toBe(false);
    expect(logs.every((l) => l.status === "success")).toBe(true);
  });

  it("valor pago divergente alarma", async () => {
    const org = await seedOrg(db);
    const link = await seedLink(db, { orgId: org, plan: "torque-1.0", seats: 2 });
    await attach(db, { linkId: link.linkId, sub: idA, invoice: invoiceId(paid1) });
    subs.set(idA, { ...projectSubscription(subA.data.object), status: "active" });
    await entregar(paid1);
    expect(logs.some((l) => l.action === "stripe_webhook_valor_divergente" && l.status === "error")).toBe(true);
  });
});

describe("outros eventos", () => {
  it("invoice.payment_failed real: histórico failed e espelha past_due, sem tocar a org", async () => {
    const { org } = await preparar();
    await entregar(paid1);
    await provisionar(invoiceId(paid1));
    const antes = await one(db, "SELECT subscription_status, subscription_expires_at FROM public.organizations WHERE id=$1", [org]);
    subs.set(idA, { ...subs.get(idA)!, status: "past_due" });
    expect((await entregar(failed)).status).toBe(200);
    expect((await one(db, "SELECT status FROM public.payment_history WHERE provider_payment_id=$1", [invoiceId(failed)])).status).toBe("failed");
    expect((await one(db, "SELECT provider_status FROM public.org_subscriptions WHERE organization_id=$1", [org])).provider_status).toBe("past_due");
    expect(await one(db, "SELECT subscription_status, subscription_expires_at FROM public.organizations WHERE id=$1", [org])).toEqual(antes);
  });

  it("customer.subscription.deleted real: cancela a linha, alarma, não rebaixa", async () => {
    const { org } = await preparar();
    await entregar(paid1);
    await provisionar(invoiceId(paid1));
    subs.set(idA, projectSubscription(deleted.data.object));
    expect((await entregar(deleted)).status).toBe(200);
    expect((await one(db, "SELECT cancelled_at IS NOT NULL c, provider_status FROM public.org_subscriptions WHERE organization_id=$1", [org]))).toEqual({ c: true, provider_status: "canceled" });
    expect((await one(db, "SELECT subscription_status FROM public.organizations WHERE id=$1", [org])).subscription_status).toBe("active");
    expect(logs.some((l) => l.action === "stripe_webhook_assinatura_cancelada")).toBe(true);
  });

  it("updated antes da primeira invoice: ignored, e invoice.paid materializa depois", async () => {
    const { org } = await preparar();
    const up = doA("customer.subscription.updated")[0];
    expect((await entregar(up)).status).toBe(200);
    expect((await ledger())[0]).toMatchObject({ status: "ignored", error_message: "subscription_not_materialized" });
    await entregar(paid1);
    expect(await all(db, "SELECT 1 FROM public.org_subscriptions WHERE organization_id=$1", [org])).toHaveLength(1);
  });

  it("assinatura apagada da conta não vira retentativa eterna", async () => {
    const up = doA("customer.subscription.updated")[0];
    expect((await entregar(up)).status).toBe(200);
  });

  it("payment_action_required: ledger e log", async () => {
    const e = { ...paid1, id: "evt_3ds", type: "invoice.payment_action_required" };
    expect((await entregar(e)).status).toBe(200);
    expect((await ledger())[0]).toMatchObject({ status: "ignored" });
    expect(logs.some((l) => l.action === "stripe_webhook_acao_requerida")).toBe(true);
  });
});

describe("critério 10: sem PII nem segredo em ledger e log", () => {
  it("evento com PII de verdade não deixa rastro", async () => {
    const { org } = await preparar();
    const email = "comprador@empresa-real.com.br";
    const doc = "11222333000181";
    const nome = "Razao Social Real";
    const url = "https://invoice.stripe.com/i/capacidade";
    const sujo = JSON.parse(JSON.stringify(paid1));
    Object.assign(sujo.data.object, {
      customer_email: email, customer_name: nome, customer_tax_ids: [{ type: "br_cnpj", value: doc }],
      hosted_invoice_url: url, invoice_pdf: url,
    });
    expect((await entregar(sujo)).status).toBe(200);

    const payloads = await all(db, "SELECT payload, error_message FROM public.payment_webhook_events");
    const historico = await all(db, "SELECT * FROM public.payment_history WHERE organization_id=$1", [org]);
    const texto = JSON.stringify({ logs, payloads, historico });
    for (const v of [email, doc, nome, url, SECRET, KEY]) expect(texto).not.toContain(v);
    expect(payloads[0].payload).toMatchObject({ invoice_id: invoiceId(paid1), amount_paid_cents: 199700, billing_reason: "subscription_create" });
  });

  it("payload é lista branca: só as chaves previstas", () => {
    expect(Object.keys(eventLedgerPayload(paid1)).sort()).toEqual([
      "amount_due_cents", "amount_paid_cents", "api_version", "billing_reason", "created", "currency", "customer_id",
      "id", "invoice_id", "livemode", "period_end", "period_start", "status", "subscription_id", "type",
    ]);
  });
});

describe("stripeErrorInfo", () => {
  it("nunca devolve message", () => {
    const info = stripeErrorInfo(Object.assign(new Error("email@x.y"), { type: "StripeCardError", code: "card_declined", requestId: "req_9", statusCode: 402 }));
    expect(info).toEqual({ type: "StripeCardError", code: "card_declined", requestId: "req_9", status: 402 });
    expect(JSON.stringify(info)).not.toContain("email");
  });
});

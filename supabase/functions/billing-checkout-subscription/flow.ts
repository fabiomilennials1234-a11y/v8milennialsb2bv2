/**
 * Criar (ou reencontrar) a assinatura de um link de pagamento. O corpo nunca traz
 * preço, plano ou organização: tudo sai do link, resolvido pelo hash do token.
 *
 * Ordem importa, e a regra é não criar objeto na Stripe antes de todo o resto passar:
 *   1. resolve o link;  2. exige existing_org, cartão, valor e o aceite da recorrência;
 *   3. recusa segunda assinatura da org e assinatura do link já paga;  4. valida o
 *   comprador e grava o aceite;  5. Customer;  6. reusa a assinatura do link;  7. cria;
 *   8. amarra ao link ANTES de o client_secret sair.
 *
 * Sem (8) antes de responder, um pagamento poderia concluir sem o webhook achar o link.
 * Token e client_secret nunca entram em log; o texto de erro da Stripe também não.
 */

import type { StripeGateway } from "../_shared/stripe/client.ts";
import { lookupKey, catalogUnits, isBillingCycle } from "../_shared/stripe/catalog.ts";
import { buildSubscriptionItems, type PriceLookupEntry } from "../_shared/stripe/items.ts";
import type { SubscriptionView } from "../_shared/stripe/events.ts";
import { isPlausibleLinkToken } from "../_shared/payment-link-token.ts";

/**
 * Versão do texto de autorização de cobrança recorrente que a tela exibe. Mudou o
 * texto, muda aqui: o aceite antigo deixa de valer e o comprador aceita de novo.
 */
export const RECURRING_CONSENT_VERSION = "2026-11-04";

export const RATE_LIMIT_TOKEN_MAX = 10;
export const RATE_LIMIT_IP_MAX = 30;
export const RATE_LIMIT_WINDOW = "5 minutes";
export const RATE_LIMIT_ENDPOINT_TOKEN = "billing-checkout-subscription:token";
export const RATE_LIMIT_ENDPOINT_IP = "billing-checkout-subscription:ip";

export interface DbError {
  code?: string;
  message?: string;
}

type Result<T> = Promise<{ data: T | null; error: DbError | null }>;

export interface CheckoutDb {
  resolveLink(token: string): Result<Record<string, unknown>>;
  upsertBuyer(args: {
    linkId: string;
    providerCustomerId: string | null;
    legalName: string;
    email: string;
    taxId: string;
  }): Result<{ ok?: boolean; code?: string }>;
  recordConsent(linkId: string, version: string): Result<{ ok?: boolean; code?: string }>;
  attachCheckout(args: {
    linkId: string;
    subscriptionId: string;
    invoiceId: string;
    customerId: string;
    attempt: number;
  }): Result<{ ok?: boolean; code?: string; must_cancel?: boolean; reason?: string | null }>;
  getOrgCustomer(orgId: string): Result<{ provider_customer_id: string; livemode: boolean }>;
  insertOrgCustomer(orgId: string, customerId: string, livemode: boolean): Promise<{ error: DbError | null }>;
  getLinkCharge(linkId: string): Result<{ provider: string; provider_subscription_id: string | null; attempt: number }>;
  otherLinkSubscriptions(
    orgId: string,
    linkId: string,
  ): Result<{ subscription_id: string; link_revoked: boolean }[]>;
  currentSubscription(orgId: string): Result<{ provider_subscription_id: string | null }>;
}

export interface CheckoutLogEntry {
  action: string;
  status: "success" | "error" | "skipped";
  organizationId?: string;
  errorMessage?: string;
  payloadSnapshot?: Record<string, unknown>;
}

export interface CheckoutDeps {
  env: string;
  livemode: boolean;
  gateway: StripeGateway;
  db: CheckoutDb;
  describeError(err: unknown): { type: string; code: string | null; requestId: string | null };
  log(entry: CheckoutLogEntry): Promise<void>;
}

export type CheckoutBody =
  | { state: "ready"; client_secret: string; livemode: boolean; amount_cents: number; billing_cycle: string }
  | { state: "consent_required"; consent_version: string }
  | { state: CheckoutRefusal };

export type CheckoutRefusal =
  | "link_not_found"
  | "link_expired"
  | "link_revoked"
  | "already_paid"
  | "target_not_supported"
  | "org_already_subscribed"
  | "tax_id_invalid"
  | "email_invalid"
  | "legal_name_missing";

export interface CheckoutInput {
  token: string;
  buyer: { legal_name: string; email: string; tax_id: string };
  /** Null quando ausente ou malformado: o fluxo responde consent_required, não 400. */
  consent: { accepted: boolean; version: string } | null;
}

export type CheckoutOutcome =
  | { status: 200; body: CheckoutBody }
  | { status: 500; body: { error: "internal_error" } };

/** Valida o corpo. Só o formato: a regra do comprador mora na RPC. */
export function parseCheckoutInput(body: unknown): CheckoutInput | null {
  const o = (body ?? {}) as Record<string, unknown>;
  const buyer = (o.buyer ?? {}) as Record<string, unknown>;
  if (typeof o.token !== "string" || o.token.length === 0 || o.token.length > 200) return null;
  const campos = [buyer.legal_name, buyer.email, buyer.tax_id];
  if (campos.some((c) => typeof c !== "string" || c.length > 320)) return null;
  const consent = (o.consent ?? {}) as Record<string, unknown>;
  return {
    token: o.token,
    buyer: {
      legal_name: buyer.legal_name as string,
      email: buyer.email as string,
      tax_id: buyer.tax_id as string,
    },
    consent: typeof consent.accepted === "boolean" && typeof consent.version === "string"
      ? { accepted: consent.accepted, version: consent.version }
      : null,
  };
}

/** A chave do balde não pode ser o hash que indexa o link: outro prefixo, outro valor. */
export async function rateLimitKey(token: string): Promise<string> {
  return (await sha256Hex(`ratelimit:billing-checkout-subscription:${token}`)).slice(0, 32);
}

/** Falha fechada: sem conseguir contar, recusa. */
export async function withinRateLimit(
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError | null }>,
  token: string,
  ip: string,
  log: (entry: CheckoutLogEntry) => Promise<void>,
): Promise<boolean> {
  const [porToken, porIp] = await Promise.all([
    rpc("check_auth_rate_limit", {
      p_ip: await rateLimitKey(token),
      p_endpoint: RATE_LIMIT_ENDPOINT_TOKEN,
      p_max: RATE_LIMIT_TOKEN_MAX,
      p_window: RATE_LIMIT_WINDOW,
    }),
    rpc("check_auth_rate_limit", {
      p_ip: ip,
      p_endpoint: RATE_LIMIT_ENDPOINT_IP,
      p_max: RATE_LIMIT_IP_MAX,
      p_window: RATE_LIMIT_WINDOW,
    }),
  ]);

  const erro = porToken.error ?? porIp.error;
  if (erro) {
    await log({
      action: "checkout_rate_limit",
      status: "error",
      errorMessage: erro.message ?? "freio indisponível",
      payloadSnapshot: { fail_closed: true },
    });
    return false;
  }
  return porToken.data !== false && porIp.data !== false;
}

async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identifica o comprador sem carregar o dado: mesma regra da chave idempotente do Customer. */
async function buyerFingerprint(legalName: string, email: string, taxId: string): Promise<string> {
  return (await sha256Hex(`${legalName}|${email}|${taxId}`)).slice(0, 16);
}

/** A Stripe recebe o documento formatado: é o formato que ela documenta para br_cnpj e br_cpf. */
export function stripeTaxId(digits: string): { type: "br_cnpj" | "br_cpf"; value: string } {
  if (digits.length === 14) {
    return {
      type: "br_cnpj",
      value: `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`,
    };
  }
  return {
    type: "br_cpf",
    value: `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`,
  };
}

/**
 * Dígitos verificadores de CPF e CNPJ. A Stripe só confere o formato: medido em modo
 * teste, ela aceitou o CNPJ 12.345.678/9012-34 sem reclamar. Sem isto, documento
 * impossível chegaria ao fiscal do Customer.
 */
export function isValidBrTaxId(digits: string): boolean {
  if (!/^(\d{11}|\d{14})$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const nums = [...digits].map(Number);
  const dv = (base: number[], pesos: number[]) => {
    const resto = base.reduce((acc, n, i) => acc + n * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  if (digits.length === 11) {
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const p2 = [11, ...p1];
    return dv(nums.slice(0, 9), p1) === nums[9] && dv(nums.slice(0, 10), p2) === nums[10];
  }
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  return dv(nums.slice(0, 12), p1) === nums[12] && dv(nums.slice(0, 13), p2) === nums[13];
}

const ASSINATURA_VIVA = new Set(["incomplete", "trialing", "active", "past_due", "unpaid", "paused"]);

const refuse = (state: CheckoutRefusal): CheckoutOutcome => ({ status: 200, body: { state } });

class CheckoutFailure extends Error {}

function must<T>(r: { data: T | null; error: DbError | null }, onde: string): T | null {
  // Erro do supabase-js é objeto puro, não `instanceof Error`.
  if (r.error) throw new CheckoutFailure(`${onde}:${r.error.code ?? "unknown"}`);
  return r.data;
}

export async function runCheckout(input: CheckoutInput, deps: CheckoutDeps): Promise<CheckoutOutcome> {
  try {
    return await checkout(input, deps);
  } catch (err) {
    const info = err instanceof CheckoutFailure ? null : deps.describeError(err);
    await deps.log({
      action: "checkout_falhou",
      status: "error",
      // Nunca `err.message` de erro da Stripe: pode ecoar dado do comprador.
      errorMessage: err instanceof CheckoutFailure ? err.message : `${info!.type}:${info!.code ?? "-"}`,
      payloadSnapshot: { request_id: info?.requestId ?? null },
    });
    return { status: 500, body: { error: "internal_error" } };
  }
}

async function checkout(input: CheckoutInput, deps: CheckoutDeps): Promise<CheckoutOutcome> {
  const { db, gateway, livemode } = deps;

  if (!isPlausibleLinkToken(input.token)) return refuse("link_not_found");

  // 1. Link
  const resolved = must(await db.resolveLink(input.token), "resolve") ?? {};
  if (resolved.ok !== true) {
    switch (resolved.code) {
      case "link_expired": return refuse("link_expired");
      case "link_revoked": return refuse("link_revoked");
      case "link_already_paid": return refuse("already_paid");
      default: return refuse("link_not_found");
    }
  }

  const linkId = resolved.link_id as string;
  const orgId = resolved.organization_id as string | null;
  const quote = (resolved.quote ?? {}) as Record<string, unknown>;
  const amountCents = Number(resolved.amount_cents);

  // 2. Só org existente, cartão e valor positivo.
  if (
    resolved.target_kind !== "existing_org" || !orgId ||
    quote.payment_method !== "credit_card" || !(amountCents > 0)
  ) {
    return refuse("target_not_supported");
  }

  // Autorização de cobrança recorrente: sem ela não nasce nada na Stripe nem no banco.
  if (input.consent?.accepted !== true || input.consent.version !== RECURRING_CONSENT_VERSION) {
    return { status: 200, body: { state: "consent_required", consent_version: RECURRING_CONSENT_VERSION } };
  }

  // Preço impossível morre aqui, antes de qualquer chamada à Stripe.
  if (!buildSubscriptionItems(quote, amountCents, new Map()).ok) {
    throw new CheckoutFailure("price_mismatch");
  }

  // 3. Segunda assinatura da mesma org. A corrida que passar daqui vira `conflict` no
  // webhook, com alarme.
  const charge = must(await db.getLinkCharge(linkId), "charge");
  const subDoLink = charge?.provider === "stripe" ? charge.provider_subscription_id : null;

  const atual = must(await db.currentSubscription(orgId), "subscription");
  if (atual && (subDoLink === null || atual.provider_subscription_id !== subDoLink)) {
    return refuse("org_already_subscribed");
  }

  const outras = must(await db.otherLinkSubscriptions(orgId, linkId), "other_links") ?? [];
  for (const outra of outras) {
    const sub = await gateway.retrieveSubscription(outra.subscription_id);
    if (!ASSINATURA_VIVA.has(sub.status)) continue;
    // Incompleta de link revogado nunca vai ser paga por quem tem direito: não trava a
    // org. Só a incompleta: assinatura paga em link revogado continua barrando.
    if (sub.status === "incomplete" && outra.link_revoked) {
      await gateway.cancelSubscription(sub.id);
      await deps.log({
        action: "checkout_incompleta_de_link_revogado_cancelada",
        status: "success",
        organizationId: orgId,
        payloadSnapshot: { link_id: linkId, subscription_id: sub.id },
      });
      continue;
    }
    return refuse("org_already_subscribed");
  }

  // Paga na Stripe com o webhook ainda a caminho: quem tem o token não mexe mais em
  // comprador nem em Customer. Por isso vem antes do passo 4.
  const existente = subDoLink ? await gateway.retrieveSubscription(subDoLink) : null;
  if (existente && !["incomplete", "incomplete_expired", "canceled"].includes(existente.status)) {
    return refuse("already_paid");
  }

  // 4. Comprador, sem ponteiro ainda. A RPC valida e não ecoa valor.
  const legalName = input.buyer.legal_name.trim();
  const email = input.buyer.email.trim().toLowerCase();
  const taxId = input.buyer.tax_id.replace(/\D/g, "");
  if (!isValidBrTaxId(taxId)) return refuse("tax_id_invalid");

  // A fatura aberta guarda o retrato de nome, e-mail e documento de quando nasceu: pagar a
  // incompleta depois de "Alterar" emitiria com o comprador errado. Troca por uma nova.
  // Antes do passo 4, para quem perdeu a corrida para um pagamento não mexer em nada.
  const buyerHash = await buyerFingerprint(legalName, email, taxId);
  let substituida = false;
  // Sem segredo é a mesma troca pela metade: anulou e o cancelamento falhou, ou a fatura foi anulada
  // à mão. Repete: anular de novo é idempotente, e `paid` vira already_paid.
  const compradorMudou = !!existente?.buyerHash && existente.buyerHash !== buyerHash;
  if (existente?.status === "incomplete" && (compradorMudou || !existente.clientSecret)) {
    if (!existente.latestInvoiceId) throw new CheckoutFailure("subscription_without_invoice");
    // A ordem é a trava: fatura anulada não aceita mais pagamento em nenhuma aba, então
    // cancelar depois disso nunca corta quem pagou nem abre segunda cobrança.
    if ((await gateway.voidInvoice(existente.latestInvoiceId)) === "paid") return refuse("already_paid");
    await gateway.cancelSubscription(existente.id);
    substituida = true;
    await deps.log({
      action: "checkout_comprador_trocado",
      status: "success",
      organizationId: orgId,
      payloadSnapshot: { link_id: linkId, subscription_id: existente.id },
    });
  }

  const buyer = must(
    await db.upsertBuyer({ linkId, providerCustomerId: null, legalName, email, taxId }),
    "buyer",
  ) ?? {};
  if (buyer.ok !== true) {
    switch (buyer.code) {
      case "tax_id_invalid": return refuse("tax_id_invalid");
      case "email_invalid": return refuse("email_invalid");
      case "legal_name_missing": return refuse("legal_name_missing");
      case "link_revoked": return refuse("link_revoked");
      case "link_already_paid": return refuse("already_paid");
      default: return refuse("link_not_found");
    }
  }

  const consent = must(await db.recordConsent(linkId, RECURRING_CONSENT_VERSION), "consent") ?? {};
  if (consent.ok !== true) throw new CheckoutFailure(`consent:${consent.code ?? "unknown"}`);

  // 5. Customer
  const customer = await ensureCustomer({ orgId, linkId, legalName, email, taxId }, deps);
  if (customer === null) return refuse("tax_id_invalid");
  must(await db.upsertBuyer({ linkId, providerCustomerId: customer, legalName, email, taxId }), "buyer_pointer");

  // 6. Reuso da assinatura do link
  let attempt = charge?.attempt ?? 0;
  if (existente?.status === "incomplete" && !substituida) {
    if (existente.consentVersion !== RECURRING_CONSENT_VERSION) {
      await gateway.updateSubscriptionMetadata(existente.id, { torque_consent_version: RECURRING_CONSENT_VERSION });
    }
    return ready(existente.clientSecret!, amountCents, quote, livemode);
  }
  attempt += 1;

  // 7. Assinatura
  const cycle = quote.billing_cycle;
  const plan = String(quote.plan_name);
  const chaves = isBillingCycle(cycle)
    ? (catalogUnits(plan, cycle, {
      seats: Number(quote.seats),
      extra_seats: Number(quote.extra_seats),
    }) ?? []).map((u) => lookupKey(plan, u.part, cycle))
    : [];
  const prices = new Map<string, PriceLookupEntry>();
  for (const p of await gateway.listPricesByLookupKeys(chaves)) {
    if (p.lookup_key) prices.set(p.lookup_key, { id: p.id, unit_amount: p.unit_amount });
  }

  const items = buildSubscriptionItems(quote, amountCents, prices);
  if (!items.ok) throw new CheckoutFailure("price_mismatch");

  const sub: SubscriptionView = await gateway.createSubscription(
    {
      customer,
      items: items.items,
      metadata: {
        torque_env: deps.env,
        torque_link_id: linkId,
        torque_org_id: orgId,
        torque_attempt: String(attempt),
        torque_consent_version: RECURRING_CONSENT_VERSION,
        torque_buyer_hash: buyerHash,
      },
    },
    // A versão entra na chave: metadata diferente sob a mesma chave é erro por 24 h.
    `torque:sub:${linkId}:${attempt}:${RECURRING_CONSENT_VERSION}`,
  );

  if (!sub.clientSecret || !sub.latestInvoiceId) throw new CheckoutFailure("subscription_without_secret");

  // 8. Amarra antes de devolver o segredo.
  const attached = must(
    await db.attachCheckout({
      linkId,
      subscriptionId: sub.id,
      invoiceId: sub.latestInvoiceId,
      customerId: customer,
      attempt,
    }),
    "attach",
  ) ?? {};

  // Link pago por esta mesma assinatura numa corrida com o webhook: nada a cancelar.
  if (!attached.must_cancel && attached.reason === "already_paid") return refuse("already_paid");

  if (attached.must_cancel) {
    await gateway.cancelSubscription(sub.id);
    await deps.log({
      action: "checkout_assinatura_cancelada",
      status: "error",
      organizationId: orgId,
      errorMessage: "link mudou de estado com a assinatura já criada",
      payloadSnapshot: { link_id: linkId, subscription_id: sub.id, reason: attached.reason ?? null },
    });
    if (attached.reason === "link_revoked") return refuse("link_revoked");
    if (attached.reason === "already_paid") return refuse("already_paid");
    throw new CheckoutFailure("stale_attempt");
  }
  if (attached.ok !== true) throw new CheckoutFailure(`attach:${attached.code ?? "unknown"}`);

  await deps.log({
    action: "checkout_pronto",
    status: "success",
    organizationId: orgId,
    payloadSnapshot: { link_id: linkId, subscription_id: sub.id, attempt, rule: items.rule },
  });

  return ready(sub.clientSecret, amountCents, quote, livemode);
}

function ready(
  clientSecret: string,
  amountCents: number,
  quote: Record<string, unknown>,
  livemode: boolean,
): CheckoutOutcome {
  return {
    status: 200,
    body: {
      state: "ready",
      client_secret: clientSecret,
      livemode,
      amount_cents: amountCents,
      billing_cycle: String(quote.billing_cycle),
    },
  };
}

/** Devolve o id do Customer, ou null se a Stripe recusou o documento. */
async function ensureCustomer(
  b: { orgId: string; linkId: string; legalName: string; email: string; taxId: string },
  deps: CheckoutDeps,
): Promise<string | null> {
  const { db, gateway, livemode } = deps;

  const existente = must(await db.getOrgCustomer(b.orgId), "customer");
  if (existente) {
    if (existente.livemode !== livemode) throw new CheckoutFailure("customer_livemode_mismatch");

    await gateway.updateCustomer(existente.provider_customer_id, { name: b.legalName, email: b.email });

    // Converge para um documento só: o atual. Sem assumir que a tentativa anterior
    // terminou, porque corrida ou delete falho deixam dois, e o POST seguinte acerta.
    // Medido em modo teste: a invoice já finalizada guarda retrato de `customer_tax_ids`,
    // então trocar não reescreve o que foi emitido. Cria antes de apagar para o Customer
    // nunca ficar sem documento.
    const docs = await gateway.listCustomerTaxIds(existente.provider_customer_id);
    const diferentes = docs.filter((d) => d.value.replace(/\D/g, "") !== b.taxId);

    if (diferentes.length === docs.length) {
      try {
        await gateway.createCustomerTaxId(existente.provider_customer_id, stripeTaxId(b.taxId));
      } catch (err) {
        const code = deps.describeError(err).code;
        if (code === "tax_id_invalid") return null;
        if (code !== "resource_already_exists") throw err;
      }
    }

    for (const d of diferentes) {
      try {
        await gateway.deleteCustomerTaxId(existente.provider_customer_id, d.id);
      } catch (err) {
        if (deps.describeError(err).code !== "resource_missing") throw err;
      }
    }

    if (diferentes.length > 0) {
      await deps.log({
        action: "checkout_documento_trocado",
        status: "success",
        organizationId: b.orgId,
        payloadSnapshot: { link_id: b.linkId },
      });
    }
    return existente.provider_customer_id;
  }

  const hash16 = await buyerFingerprint(b.legalName, b.email, b.taxId);
  let id: string;
  try {
    id = await gateway.createCustomer(
      {
        name: b.legalName,
        email: b.email,
        taxId: stripeTaxId(b.taxId),
        metadata: { torque_env: deps.env, torque_org_id: b.orgId },
      },
      `torque:customer:${b.orgId}:${hash16}`,
    );
  } catch (err) {
    if (deps.describeError(err).code === "tax_id_invalid") return null;
    throw err;
  }

  // Corrida entre duas abas: o primeiro ponteiro vence. Quem perdeu leva o comprador atual para
  // o Customer vencedor, pelo mesmo caminho do reuso, e apaga o seu, que não tem assinatura.
  const { error } = await db.insertOrgCustomer(b.orgId, id, livemode);
  if (error && error.code !== "23505") throw new CheckoutFailure(`customer_insert:${error.code ?? "unknown"}`);
  if (error) {
    const vencedor = must(await db.getOrgCustomer(b.orgId), "customer_reread");
    if (!vencedor) throw new CheckoutFailure("customer_lost");
    const convergido = await ensureCustomer(b, deps);
    // Mesma chave idempotente devolve o mesmo Customer nas duas abas: aí não há órfão.
    if (id !== vencedor.provider_customer_id) {
      try {
        await gateway.deleteCustomer(id);
      } catch (err) {
        await deps.log({
          action: "checkout_customer_orfao",
          status: "error",
          organizationId: b.orgId,
          errorMessage: deps.describeError(err).code ?? "desconhecido",
          payloadSnapshot: { customer_id: id },
        });
      }
    }
    return convergido;
  }
  return id;
}

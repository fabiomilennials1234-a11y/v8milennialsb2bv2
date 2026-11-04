/**
 * O evento da Stripe vira fato no banco. Sem Deno e sem SDK aqui: `index.ts` injeta
 * verificação, recuperação e banco, e o teste usa os reais contra PGlite.
 *
 * Diferente do asaas-webhook, falha real responde 500: a Stripe reentrega por até 3
 * dias e não pausa fila. Responder 200 sempre seria copiar uma regra do Asaas que aqui
 * esconderia pagante sem acesso.
 *
 * Estado do ledger na reentrega: `applied`/`ignored`/`unknown_type` respondem 200;
 * `received`/`failed` REPROCESSAM. A idempotência real mora na RPC, com FOR UPDATE.
 *
 * Log: só ids, tipo, status e o código do erro. Nunca o evento cru.
 */

import type { StripeConfigResult } from "../_shared/stripe/env.ts";
import {
  eventLedgerPayload,
  eventPaymentId,
  isHandledEvent,
  projectInvoice,
  projectSubscription,
  type StripeEventLike,
  type SubscriptionView,
} from "../_shared/stripe/events.ts";

export interface DbError {
  code?: string;
  message?: string;
}

export interface WebhookLogEntry {
  action: string;
  status: "success" | "error" | "skipped";
  organizationId?: string;
  errorMessage?: string;
  payloadSnapshot?: Record<string, unknown>;
}

export interface WebhookDeps {
  config: StripeConfigResult;
  verify(rawBody: string, signature: string): Promise<StripeEventLike>;
  retrieveSubscription(id: string): Promise<SubscriptionView>;
  describeError(err: unknown): { type: string; code: string | null; requestId: string | null };
  insertEvent(row: {
    provider_event_id: string;
    event_type: string;
    provider_payment_id: string | null;
    status: "received" | "unknown_type";
    payload: Record<string, unknown>;
  }): Promise<{ data: { id: string } | null; error: DbError | null }>;
  findEvent(providerEventId: string): Promise<{ data: { id: string; status: string } | null; error: DbError | null }>;
  markEvent(id: string, status: "failed" | "ignored", errorMessage: string | null): Promise<void>;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: DbError | null }>;
  log(entry: WebhookLogEntry): Promise<void>;
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

const reply = (status: number, body: Record<string, unknown>): WebhookResponse => ({ status, body });

interface RpcResult {
  ok?: boolean;
  code?: string;
  organization_id?: string;
  amount_mismatch?: boolean;
  link_revoked?: boolean;
}

/** Falha que precisa de reentrega: vira `failed` no ledger e 500 para a Stripe. */
class RetryableFailure extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

export async function handleStripeWebhook(
  request: { rawBody: string; signature: string | null },
  deps: WebhookDeps,
): Promise<WebhookResponse> {
  if (!deps.config.ok || !deps.config.config.webhookSecret) {
    return reply(503, { error: "billing_not_configured" });
  }
  const { livemode } = deps.config.config;

  if (!request.signature) return reply(400, { error: "invalid_signature" });

  let event: StripeEventLike;
  try {
    event = await deps.verify(request.rawBody, request.signature);
  } catch {
    // Sem log: a URL é pública, e varredura com assinatura inválida encheria runtime_logs.
    return reply(400, { error: "invalid_signature" });
  }

  // Evento de outro modo não encosta no banco: chave de teste num ambiente live, ou o
  // contrário, é erro de configuração.
  if (event.livemode !== livemode) {
    await deps.log({
      action: "stripe_webhook_modo_divergente",
      status: "error",
      errorMessage: "livemode do evento diverge de STRIPE_ENV",
      payloadSnapshot: { event_id: event.id, event_type: event.type },
    });
    return reply(400, { error: "livemode_mismatch" });
  }

  const handled = isHandledEvent(event.type);
  const { data: inserted, error: insertError } = await deps.insertEvent({
    provider_event_id: event.id,
    event_type: event.type,
    provider_payment_id: eventPaymentId(event),
    status: handled ? "received" : "unknown_type",
    payload: eventLedgerPayload(event),
  });

  let rowId = inserted?.id ?? null;

  if (insertError?.code === "23505") {
    const { data: existente, error: findError } = await deps.findEvent(event.id);
    if (findError || !existente) {
      await deps.log({
        action: "stripe_webhook_ledger_falhou",
        status: "error",
        errorMessage: findError?.message ?? "evento sumiu do ledger",
        payloadSnapshot: { event_id: event.id },
      });
      return reply(500, { error: "ledger_unavailable" });
    }
    if (existente.status !== "received" && existente.status !== "failed") {
      return reply(200, { received: true, duplicate: true });
    }
    rowId = existente.id;
  } else if (insertError || !rowId) {
    await deps.log({
      action: "stripe_webhook_ledger_falhou",
      status: "error",
      errorMessage: insertError?.message ?? "insert sem retorno",
      payloadSnapshot: { event_id: event.id, event_type: event.type },
    });
    return reply(500, { error: "ledger_unavailable" });
  }

  if (!handled) return reply(200, { received: true, absorbed: true });

  try {
    await dispatch(event, rowId!, deps);
    return reply(200, { received: true });
  } catch (err) {
    const reason = err instanceof RetryableFailure ? err.reason : "unexpected";
    await deps.markEvent(rowId!, "failed", reason);
    await deps.log({
      action: "stripe_webhook_falhou",
      status: "error",
      errorMessage: reason,
      payloadSnapshot: { event_id: event.id, event_type: event.type },
    });
    return reply(500, { error: "processing_failed" });
  }
}

async function dispatch(event: StripeEventLike, rowId: string, deps: WebhookDeps): Promise<void> {
  switch (event.type) {
    case "invoice.paid":
      return await onInvoicePaid(event, rowId, deps);
    case "invoice.payment_failed":
      return await onInvoiceFailed(event, rowId, deps);
    case "invoice.payment_action_required": {
      await deps.markEvent(rowId, "ignored", null);
      await deps.log({
        action: "stripe_webhook_acao_requerida",
        status: "skipped",
        payloadSnapshot: { event_id: event.id, invoice_id: eventPaymentId(event) },
      });
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return await onSubscriptionChange(event, rowId, deps);
  }
}

/**
 * Estado atual, nunca o do evento: a entrega não tem ordem. Objeto sumiu da conta
 * devolve null, e reentregar não vai trazê-lo de volta.
 */
async function currentSubscription(id: string, deps: WebhookDeps): Promise<SubscriptionView | null> {
  try {
    return await deps.retrieveSubscription(id);
  } catch (err) {
    const info = deps.describeError(err);
    if (info.code === "resource_missing") return null;
    await deps.log({
      action: "stripe_webhook_recuperar_assinatura_falhou",
      status: "error",
      errorMessage: `${info.type}:${info.code ?? "-"}`,
      payloadSnapshot: { subscription_id: id, request_id: info.requestId },
    });
    throw new RetryableFailure("stripe_unavailable");
  }
}

async function callRpc(name: string, args: Record<string, unknown>, deps: WebhookDeps): Promise<RpcResult> {
  const { data, error } = await deps.rpc(name, args);
  // Erro do supabase-js é objeto puro, não `instanceof Error`.
  if (error) throw new RetryableFailure(`rpc:${error.code ?? "unknown"}`);
  return (data ?? {}) as RpcResult;
}

async function onInvoicePaid(event: StripeEventLike, rowId: string, deps: WebhookDeps): Promise<void> {
  const invoice = projectInvoice(event.data.object);

  if (!invoice.subscriptionId) {
    await deps.markEvent(rowId, "ignored", "invoice_without_subscription");
    return;
  }

  const sub = await currentSubscription(invoice.subscriptionId, deps);
  if (!sub) {
    await deps.markEvent(rowId, "failed", "subscription_missing_on_stripe");
    await deps.log({
      action: "stripe_webhook_assinatura_ausente",
      status: "error",
      errorMessage: "invoice paga de assinatura que a Stripe não conhece",
      payloadSnapshot: { event_id: event.id, invoice_id: invoice.id },
    });
    return;
  }

  // invoice.paid e a virada para active saem quase juntas. Se esta é a última invoice da
  // assinatura, ela está paga e o estado lido é que chegou antes: conta como active.
  // Incompleta com outra invoice mais nova não tem como estar viva: reentrega.
  const eAUltima = sub.latestInvoiceId === invoice.id;
  if (sub.status === "incomplete" && !eAUltima) {
    throw new RetryableFailure("subscription_still_incomplete");
  }
  const statusEfetivo = eAUltima && (sub.status === "incomplete" || sub.status === "past_due")
    ? "active"
    : sub.status;

  const result = await callRpc("billing_stripe_apply_invoice_paid", {
    p_event_row_id: rowId,
    p_invoice_id: invoice.id,
    p_subscription_id: invoice.subscriptionId,
    p_amount_paid_cents: invoice.amountPaidCents,
    p_currency: invoice.currency,
    p_period_start: invoice.periodStart,
    p_period_end: invoice.periodEnd,
    p_paid_at: invoice.paidAt,
    p_billing_reason: invoice.billingReason,
    p_status: statusEfetivo,
    p_cancel_at_period_end: sub.cancelAtPeriodEnd,
  }, deps);

  const snapshot = {
    event_id: event.id,
    invoice_id: invoice.id,
    subscription_id: invoice.subscriptionId,
    code: result.code,
  };

  switch (result.code) {
    case "subscription_unknown":
      await deps.log({
        action: "stripe_webhook_assinatura_desconhecida",
        status: "error",
        errorMessage: "invoice paga sem link correspondente",
        payloadSnapshot: snapshot,
      });
      break;
    case "conflict":
      await deps.log({
        action: "stripe_webhook_conflito_assinatura",
        status: "error",
        organizationId: result.organization_id,
        errorMessage: "organização com outra assinatura viva: cobrança paga exige humano",
        payloadSnapshot: snapshot,
      });
      break;
    case "not_active":
      await deps.log({
        action: "stripe_webhook_paga_nao_ativa",
        status: "error",
        organizationId: result.organization_id,
        errorMessage: "invoice paga com assinatura que não está ativa: exige humano",
        payloadSnapshot: { ...snapshot, subscription_status: sub.status },
      });
      break;
    default:
      await deps.log({
        action: "stripe_webhook_aplicado",
        status: "success",
        organizationId: result.organization_id,
        payloadSnapshot: snapshot,
      });
  }

  if (result.link_revoked) {
    // Não recusa: o dinheiro já entrou. Alguém decide entre manter e estornar.
    await deps.log({
      action: "stripe_webhook_paga_link_revogado",
      status: "error",
      organizationId: result.organization_id,
      errorMessage: "pagamento concluído em link revogado: exige humano",
      payloadSnapshot: snapshot,
    });
  }

  if (result.amount_mismatch) {
    await deps.log({
      action: "stripe_webhook_valor_divergente",
      status: "error",
      organizationId: result.organization_id,
      errorMessage: "valor pago diferente do valor do link",
      payloadSnapshot: { ...snapshot, amount_paid_cents: invoice.amountPaidCents, currency: invoice.currency },
    });
  }
}

async function onInvoiceFailed(event: StripeEventLike, rowId: string, deps: WebhookDeps): Promise<void> {
  const invoice = projectInvoice(event.data.object);
  if (!invoice.subscriptionId) {
    await deps.markEvent(rowId, "ignored", "invoice_without_subscription");
    return;
  }
  const sub = await currentSubscription(invoice.subscriptionId, deps);
  const result = await callRpc("billing_stripe_apply_invoice_failed", {
    p_event_row_id: rowId,
    p_invoice_id: invoice.id,
    p_subscription_id: invoice.subscriptionId,
    p_amount_due_cents: invoice.amountDueCents,
    p_period_start: invoice.periodStart,
    p_period_end: invoice.periodEnd,
    p_status: sub?.status ?? "unknown",
  }, deps);
  await deps.log({
    action: "stripe_webhook_invoice_falhou",
    status: "skipped",
    organizationId: result.organization_id,
    payloadSnapshot: { event_id: event.id, invoice_id: invoice.id, code: result.code },
  });
}

async function onSubscriptionChange(event: StripeEventLike, rowId: string, deps: WebhookDeps): Promise<void> {
  const doEvento = projectSubscription(event.data.object);
  const sub = await currentSubscription(doEvento.id, deps) ?? doEvento;

  const result = await callRpc("billing_stripe_mirror_subscription", {
    p_event_row_id: rowId,
    p_subscription_id: sub.id,
    p_status: sub.status,
    p_period_end: sub.periodEnd,
    p_cancel_at_period_end: sub.cancelAtPeriodEnd,
    p_ended_at: sub.endedAt,
  }, deps);

  if (event.type === "customer.subscription.deleted" && result.code === "applied") {
    // Nesta entrega o cancelamento não rebaixa a org. Alguém precisa ficar sabendo.
    await deps.log({
      action: "stripe_webhook_assinatura_cancelada",
      status: "error",
      organizationId: result.organization_id,
      errorMessage: "assinatura cancelada na Stripe; organização segue ativa até a validade",
      payloadSnapshot: { event_id: event.id, subscription_id: sub.id },
    });
  }
}

/**
 * Projeção pura dos objetos da Stripe. Nada aqui fala com rede nem banco.
 *
 * `payload` é LISTA BRANCA: é o que vai para `payment_webhook_events`. O evento cru
 * tem nome, e-mail, documento (`customer_tax_ids`) e URLs de capacidade
 * (`hosted_invoice_url`, `invoice_pdf`) — nada disso entra.
 *
 * Período: vem das LINHAS da invoice, nunca de `invoice.period_*`. Medido na F0: na
 * invoice de renovação `period_start/end` é o ciclo ANTERIOR, e na primeira invoice
 * os dois são iguais. Usar o campo errado daria validade um ciclo atrasada.
 */

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === "object" ? v as Obj : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const idDe = (v: unknown): string | null => str(v) ?? str(obj(v).id);

export const epochToIso = (epoch: number | null): string | null =>
  epoch === null ? null : new Date(epoch * 1000).toISOString();

export interface StripeEventLike {
  id: string;
  type: string;
  livemode: boolean;
  api_version?: string | null;
  created?: number;
  data: { object: unknown };
}

export interface InvoiceView {
  id: string;
  subscriptionId: string | null;
  customerId: string | null;
  status: string | null;
  billingReason: string | null;
  amountPaidCents: number;
  amountDueCents: number;
  currency: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
}

export function projectInvoice(raw: unknown): InvoiceView {
  const o = obj(raw);
  const linhas = (obj(o.lines).data as unknown[] | undefined) ?? [];
  const periodos = linhas.map((l) => obj(obj(l).period));
  const inicios = periodos.map((p) => num(p.start)).filter((n): n is number => n !== null);
  const fins = periodos.map((p) => num(p.end)).filter((n): n is number => n !== null);

  const subDetails = obj(obj(o.parent).subscription_details);

  return {
    id: str(o.id) ?? "",
    subscriptionId: idDe(subDetails.subscription),
    customerId: idDe(o.customer),
    status: str(o.status),
    billingReason: str(o.billing_reason),
    amountPaidCents: num(o.amount_paid) ?? 0,
    amountDueCents: num(o.amount_due) ?? 0,
    currency: str(o.currency),
    periodStart: epochToIso(inicios.length ? Math.min(...inicios) : null),
    periodEnd: epochToIso(fins.length ? Math.max(...fins) : null),
    paidAt: epochToIso(num(obj(o.status_transitions).paid_at)),
  };
}

export interface SubscriptionView {
  id: string;
  status: string;
  customerId: string | null;
  latestInvoiceId: string | null;
  clientSecret: string | null;
  cancelAtPeriodEnd: boolean;
  periodEnd: string | null;
  endedAt: string | null;
  livemode: boolean;
  consentVersion: string | null;
  /** Hash do comprador com que a assinatura nasceu. A fatura guarda o retrato dele. */
  buyerHash: string | null;
}

export function projectSubscription(raw: unknown): SubscriptionView {
  const o = obj(raw);
  const itens = (obj(o.items).data as unknown[] | undefined) ?? [];
  const fins = itens.map((i) => num(obj(i).current_period_end)).filter((n): n is number => n !== null);
  const invoice = o.latest_invoice;

  return {
    id: str(o.id) ?? "",
    status: str(o.status) ?? "",
    customerId: idDe(o.customer),
    latestInvoiceId: idDe(invoice),
    clientSecret: str(obj(obj(invoice).confirmation_secret).client_secret),
    cancelAtPeriodEnd: o.cancel_at_period_end === true,
    periodEnd: epochToIso(fins.length ? Math.max(...fins) : null),
    endedAt: epochToIso(num(o.ended_at)),
    livemode: o.livemode === true,
    consentVersion: str(obj(o.metadata).torque_consent_version),
    buyerHash: str(obj(o.metadata).torque_buyer_hash),
  };
}

export const HANDLED_EVENT_TYPES = [
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export type HandledEventType = typeof HANDLED_EVENT_TYPES[number];

export function isHandledEvent(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

/** O que entra em `payment_webhook_events.payload`. Lista branca, campo a campo. */
export function eventLedgerPayload(event: StripeEventLike): Record<string, unknown> {
  const base = {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    api_version: event.api_version ?? null,
    created: event.created ?? null,
  };

  if (event.type.startsWith("invoice.")) {
    const i = projectInvoice(event.data.object);
    return {
      ...base,
      invoice_id: i.id,
      subscription_id: i.subscriptionId,
      customer_id: i.customerId,
      status: i.status,
      billing_reason: i.billingReason,
      amount_paid_cents: i.amountPaidCents,
      amount_due_cents: i.amountDueCents,
      currency: i.currency,
      period_start: i.periodStart,
      period_end: i.periodEnd,
    };
  }

  if (event.type.startsWith("customer.subscription.")) {
    const s = projectSubscription(event.data.object);
    return {
      ...base,
      subscription_id: s.id,
      customer_id: s.customerId,
      status: s.status,
      cancel_at_period_end: s.cancelAtPeriodEnd,
      period_end: s.periodEnd,
      ended_at: s.endedAt,
    };
  }

  return base;
}

/** Id usado em `payment_webhook_events.provider_payment_id`: a invoice, quando houver. */
export function eventPaymentId(event: StripeEventLike): string | null {
  return event.type.startsWith("invoice.") ? str(obj(event.data.object).id) : null;
}

/**
 * Transporte das três portas públicas do checkout: `billing-payment-link`,
 * `billing-checkout-subscription` e `billing-payment-status`.
 *
 * `fetch` direto e não `supabase.functions.invoke`: as três têm verify_jwt=false e a
 * autorização é o conhecimento do token. O JWT de quem por acaso está logado não tem nada
 * a fazer aqui, e não deve viajar junto.
 *
 * Nada aqui lança: toda saída é um desfecho nomeado. O motivo é o reporter global do React
 * Query, que mandaria ao Sentry todo erro lançado. Link vencido é desfecho, não incidente.
 * Token, documento e client_secret nunca entram em exceção, log ou rastro.
 */

export interface CheckoutLink {
  amount_cents: number;
  expires_at: string;
  target_kind: string;
  display_name: string | null;
  next_charge_preview_at: string | null;
  plan: {
    slug: string | null;
    name: string | null;
    billing_cycle: string | null;
    cycle_months: number | null;
    seats: number | null;
  };
  totals: {
    subtotal_cents: number | null;
    cycle_discount_cents: number | null;
    coupon_discount_cents: number | null;
    manual_discount_cents: number | null;
    monthly_cents: number | null;
    charge_cents: number | null;
  };
}

export type LinkOutcome =
  | { kind: "valid"; link: CheckoutLink }
  | { kind: "not_found" | "expired" | "revoked" | "already_paid" }
  | { kind: "rate_limited" | "offline" | "unavailable" };

export interface StartSubscriptionInput {
  token: string;
  buyer: { legal_name: string; email: string; tax_id: string };
  consent: { accepted: true; version: string };
}

export type StartOutcome =
  | { kind: "ready"; clientSecret: string; livemode: boolean; amountCents: number; billingCycle: string }
  | { kind: "terminal"; state: "not_found" | "expired" | "revoked" | "already_paid" | "not_supported" | "org_subscribed" }
  | { kind: "field"; field: "taxId" | "email" | "legalName" }
  | { kind: "consent_required" }
  | { kind: "rate_limited" | "offline" | "unavailable" };

export type StatusOutcome = "pending" | "paid" | "expired" | "failed" | null;

const TIMEOUT_MS = 30_000;

async function post(fn: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> } | null> {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  try {
    const response = await fetch(`${base}/functions/v1/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      // Corpo que não é JSON (proxy na frente, 502): o status decide sozinho.
    }
    return { status: response.status, json };
  } catch {
    return null;
  }
}

/** O token vem da URL: `/checkout/%00` não pode virar 500 na porta pública. */
const PLAUSIBLE_TOKEN = /^[\x21-\x7e]{1,200}$/;

export async function fetchCheckoutLink(token: string): Promise<LinkOutcome> {
  if (!PLAUSIBLE_TOKEN.test(token)) return { kind: "not_found" };
  const r = await post("billing-payment-link", { token });
  if (!r) return { kind: "offline" };
  if (r.status === 429) return { kind: "rate_limited" };
  if (r.status !== 200) return { kind: "unavailable" };
  switch (r.json.state) {
    case "valid":
      return r.json.link ? { kind: "valid", link: r.json.link as unknown as CheckoutLink } : { kind: "unavailable" };
    case "not_found":
    case "expired":
    case "revoked":
    case "already_paid":
      return { kind: r.json.state };
    default:
      // `state` é enum aberto a acréscimo: valor novo não pode virar formulário de cobrança.
      return { kind: "unavailable" };
  }
}

export async function startSubscription(input: StartSubscriptionInput): Promise<StartOutcome> {
  const r = await post("billing-checkout-subscription", input);
  if (!r) return { kind: "offline" };
  if (r.status === 429) return { kind: "rate_limited" };
  if (r.status !== 200) return { kind: "unavailable" };
  const j = r.json;
  switch (j.state) {
    case "ready":
      if (typeof j.client_secret !== "string" || typeof j.amount_cents !== "number" || typeof j.billing_cycle !== "string" || typeof j.livemode !== "boolean") {
        return { kind: "unavailable" };
      }
      return { kind: "ready", clientSecret: j.client_secret, livemode: j.livemode, amountCents: j.amount_cents, billingCycle: j.billing_cycle };
    case "consent_required":
      return { kind: "consent_required" };
    case "link_not_found":
      return { kind: "terminal", state: "not_found" };
    case "link_expired":
      return { kind: "terminal", state: "expired" };
    case "link_revoked":
      return { kind: "terminal", state: "revoked" };
    case "already_paid":
      return { kind: "terminal", state: "already_paid" };
    case "target_not_supported":
      return { kind: "terminal", state: "not_supported" };
    case "org_already_subscribed":
      return { kind: "terminal", state: "org_subscribed" };
    case "tax_id_invalid":
      return { kind: "field", field: "taxId" };
    case "email_invalid":
      return { kind: "field", field: "email" };
    case "legal_name_missing":
      return { kind: "field", field: "legalName" };
    default:
      return { kind: "unavailable" };
  }
}

/** Falha aqui é silenciosa por contrato: o `succeeded` da Stripe é o fato, e nada o desdiz. */
export async function fetchCheckoutStatus(token: string): Promise<StatusOutcome> {
  const r = await post("billing-payment-status", { token });
  if (!r || r.status !== 200) return null;
  const state = r.json.state;
  return state === "pending" || state === "paid" || state === "expired" || state === "failed" ? state : null;
}

/**
 * O recorte público do link de pagamento — lógica pura, sem Deno, testável no
 * vitest.
 *
 * A página do checkout é PÚBLICA: não há JWT, e a autorização é o CONHECIMENTO
 * DO TOKEN. Isso muda duas coisas em relação a um endpoint normal:
 *
 *   1. o token é credencial — não pode aparecer em log, erro ou telemetria;
 *   2. a resposta é lista BRANCA, nunca a linha do banco filtrada. Whitelist
 *      erra para o lado de faltar campo; blacklist erra para o lado de vazar o
 *      campo que alguém acrescentou depois e esqueceu de excluir.
 *
 * Contrato fechado com o Fole (frontend) antes de existir código:
 *   - HTTP 200 nos QUATRO estados conhecidos, inclusive os inválidos. Link
 *     vencido não é incidente, é desfecho — a página precisa renderizar, e
 *     4xx/410 ainda sujaria a telemetria de erro, escondendo incidente real no
 *     meio de desfecho esperado.
 *   - sem `message`: a copy é do front. Aqui vai o ESTADO, e o front decide
 *     ícone, ação e layout. Microcopy em dois lugares vira drift.
 *   - `state` é enum FECHADO. Pode-se ACRESCENTAR estado (o front renderiza
 *     fallback genérico para valor desconhecido); não se pode RENOMEAR os
 *     quatro atuais.
 */

/** Estados conhecidos. Acrescentar é permitido; renomear quebra o front. */
export const PUBLIC_LINK_STATES = [
  "valid",
  "expired",
  "already_paid",
  "revoked",
  "not_found",
] as const;

export type PublicLinkState = (typeof PUBLIC_LINK_STATES)[number];

/** Códigos que `billing_resolve_payment_link` devolve, traduzidos para o front. */
const CODE_TO_STATE: Record<string, PublicLinkState> = {
  link_expired: "expired",
  link_already_paid: "already_paid",
  link_revoked: "revoked",
  link_not_found: "not_found",
};

export interface ResolveResult {
  ok: boolean;
  code?: string;
  link_id?: string;
  target_kind?: string;
  organization_id?: string | null;
  new_org_name?: string | null;
  quote?: Record<string, unknown> | null;
  amount_cents?: number;
  expires_at?: string;
}

export interface PlanLabels {
  /** `subscription_plans.name` — a chave estável ('pro'), não o rótulo. */
  slug: string | null;
  /** `subscription_plans.display_name` — rótulo de SKU; o front não exibe cru. */
  name: string | null;
}

export interface PublicLinkResponse {
  state: PublicLinkState;
  link?: {
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
  };
}

/**
 * Soma meses em UTC com AMARRA no fim do mês.
 *
 * A aritmética ingênua (`setMonth(+1)` sobre 31/jan) transborda para 03/mar, e
 * a página anunciaria uma data de cobrança que não existe no calendário do
 * cliente. 31/jan + 1 mês aqui é 28/fev (ou 29 em bissexto).
 *
 * Isto roda no servidor de propósito: o Fole pediu explicitamente para não
 * calcular no navegador, onde o relógio, o fuso e o horário de verão do
 * visitante entram na conta.
 */
export function addMonthsUtc(from: Date, months: number): Date {
  const ano = from.getUTCFullYear();
  const mes = from.getUTCMonth();
  const dia = from.getUTCDate();

  const ultimoDiaDoMesAlvo = new Date(Date.UTC(ano, mes + months + 1, 0)).getUTCDate();

  return new Date(Date.UTC(
    ano,
    mes + months,
    Math.min(dia, ultimoDiaDoMesAlvo),
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
    from.getUTCMilliseconds(),
  ));
}

function inteiroOuNulo(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Monta a resposta pública. `orgName` só é consultado pelo chamador quando o
 * link aponta para organização existente — e é campo pedido pelo front com
 * motivo: no instante do pagamento, a pergunta que trava a pessoa é "estou
 * pagando a conta certa?", e link pago na conta errada não se desfaz com um
 * clique. Quem tem o link já sabe de quem ele é, então o nome não conta nada
 * novo a quem o recebeu.
 */
export function shapePublicLink(
  resolved: ResolveResult,
  plan: PlanLabels,
  orgName: string | null,
  now: Date,
): PublicLinkResponse {
  if (!resolved.ok) {
    // Código desconhecido cai em `not_found`: na dúvida, o estado que conta
    // MENOS ao visitante.
    return { state: CODE_TO_STATE[resolved.code ?? ""] ?? "not_found" };
  }

  const quote = (resolved.quote ?? {}) as Record<string, unknown>;
  const cycleMonths = inteiroOuNulo(quote.cycle_months);

  return {
    state: "valid",
    link: {
      amount_cents: resolved.amount_cents ?? 0,
      expires_at: resolved.expires_at ?? "",
      target_kind: resolved.target_kind ?? "",
      display_name: textoOuNulo(resolved.new_org_name) ?? textoOuNulo(orgName),
      next_charge_preview_at:
        cycleMonths && cycleMonths > 0 ? addMonthsUtc(now, cycleMonths).toISOString() : null,
      plan: {
        slug: plan.slug,
        name: plan.name,
        billing_cycle: textoOuNulo(quote.billing_cycle),
        cycle_months: cycleMonths,
        seats: inteiroOuNulo(quote.seats),
      },
      totals: {
        subtotal_cents: inteiroOuNulo(quote.subtotal_cents),
        cycle_discount_cents: inteiroOuNulo(quote.cycle_discount_cents),
        coupon_discount_cents: inteiroOuNulo(quote.coupon_discount_cents),
        manual_discount_cents: inteiroOuNulo(quote.manual_discount_cents),
        monthly_cents: inteiroOuNulo(quote.monthly_cents),
        charge_cents: inteiroOuNulo(quote.charge_cents),
      },
    },
  };
}

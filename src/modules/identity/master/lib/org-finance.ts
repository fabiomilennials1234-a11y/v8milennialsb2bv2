/**
 * Financeiro da org — quanto paga ao Torque, quanto custa para nós, margem.
 *
 * Os fatos vêm de `master_org_finance` (migration 20271111000000); a conta
 * mora aqui, à vista e testada. Tudo em centavos de real.
 *
 * Mensalidade:
 *   contrato  valor que o master gravou (`org_billing`). É o número real.
 *   tabela    sem contrato: preço de lista do plano para os usuários ativos.
 *             A cobrança não passa pelo sistema (medido 2026-10-08: zero
 *             linhas de assinatura/pagamento), então a estimativa existe para
 *             a tela não ficar vazia — e aparece marcada como estimativa.
 *
 * Custo = chips Uazapi × preço por chip
 *       + tokens de LLM em 30 dias × preço (US$ → R$ pelo câmbio)
 *       + infra fixa ÷ orgs em uso (só org em uso absorve infra).
 * O LLM é um PISO: o Copilot V2 não grava tokens.
 */

export interface OrgFinanceFacts {
  organization_id: string;
  monthly_fee_cents: number | null;
  fee_notes: string | null;
  fee_updated_at: string | null;
  uazapi_chips: number;
  llm_input_tokens_30d: number;
  llm_output_tokens_30d: number;
  client_revenue_30d: number;
  client_sales_30d: number;
}

export interface CostSettings {
  chip_monthly_cents: number;
  infra_fixed_monthly_cents: number;
  llm_input_usd_per_mtok: number;
  llm_output_usd_per_mtok: number;
  usd_brl: number;
}

/** Colunas de preço de `subscription_plans` (valores em reais). */
export interface PlanPricing {
  name: string;
  price_monthly: number | null;
  base_price_monthly: number | null;
  price_per_user_monthly: number | null;
  included_users: number | null;
  extra_user_price: number | null;
  min_users: number | null;
}

export type FeeSource = "contrato" | "tabela" | "sem_plano";

export interface OrgCost {
  chipsCents: number;
  /** null quando há tokens mas o câmbio não foi informado. */
  llmCents: number | null;
  infraCents: number;
  totalCents: number;
}

export interface OrgFinance {
  feeCents: number;
  feeSource: FeeSource;
  cost: OrgCost;
  marginCents: number;
  /** null quando a mensalidade é zero. */
  marginPct: number | null;
  clientRevenue30d: number;
  clientSales30d: number;
}

const toCents = (reais: number | null | undefined) => Math.round(Number(reais ?? 0) * 100);

/**
 * Preço de lista do plano, nas três formas que `subscription_plans` usa:
 *   base + excedente   torque-v8: base com N usuários inclusos + valor por extra
 *   por usuário        torque-1.0/2.0: valor × usuários, com mínimo
 *   fixo               planos antigos: `price_monthly`
 */
export function listPriceCents(plan: PlanPricing, users: number): number {
  const u = Math.max(0, users);
  if (plan.base_price_monthly != null) {
    const extra = Math.max(0, u - (plan.included_users ?? 0));
    return toCents(plan.base_price_monthly) + extra * toCents(plan.extra_user_price);
  }
  if (plan.price_per_user_monthly != null) {
    return Math.max(u, plan.min_users ?? 0) * toCents(plan.price_per_user_monthly);
  }
  return toCents(plan.price_monthly);
}

export function orgCost(
  facts: Pick<OrgFinanceFacts, "uazapi_chips" | "llm_input_tokens_30d" | "llm_output_tokens_30d">,
  settings: CostSettings,
  inUse: boolean,
  orgsInUse: number,
): OrgCost {
  const chipsCents = facts.uazapi_chips * settings.chip_monthly_cents;

  const usd =
    (facts.llm_input_tokens_30d / 1e6) * settings.llm_input_usd_per_mtok +
    (facts.llm_output_tokens_30d / 1e6) * settings.llm_output_usd_per_mtok;
  const llmCents = usd === 0 ? 0 : settings.usd_brl > 0 ? Math.round(usd * settings.usd_brl * 100) : null;

  const infraCents = inUse && orgsInUse > 0 ? Math.round(settings.infra_fixed_monthly_cents / orgsInUse) : 0;

  return { chipsCents, llmCents, infraCents, totalCents: chipsCents + (llmCents ?? 0) + infraCents };
}

export function orgFinance(args: {
  facts: OrgFinanceFacts | undefined;
  plan: PlanPricing | undefined;
  users: number;
  settings: CostSettings;
  inUse: boolean;
  orgsInUse: number;
}): OrgFinance {
  const { facts, plan, users, settings, inUse, orgsInUse } = args;

  const [feeCents, feeSource]: [number, FeeSource] =
    facts?.monthly_fee_cents != null
      ? [facts.monthly_fee_cents, "contrato"]
      : plan
        ? [listPriceCents(plan, users), "tabela"]
        : [0, "sem_plano"];

  const cost = orgCost(
    facts ?? { uazapi_chips: 0, llm_input_tokens_30d: 0, llm_output_tokens_30d: 0 },
    settings,
    inUse,
    orgsInUse,
  );
  const marginCents = feeCents - cost.totalCents;

  return {
    feeCents,
    feeSource,
    cost,
    marginCents,
    marginPct: feeCents > 0 ? marginCents / feeCents : null,
    clientRevenue30d: Number(facts?.client_revenue_30d ?? 0),
    clientSales30d: facts?.client_sales_30d ?? 0,
  };
}

export interface FinanceTotals {
  feeCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
  contratos: number;
  estimadas: number;
  clientRevenue30d: number;
  /** Alguma org tem tokens sem câmbio: o custo de LLM ficou de fora. */
  llmSemCambio: boolean;
}

export function sumFinance(list: OrgFinance[]): FinanceTotals {
  const t = list.reduce(
    (acc, f) => {
      acc.feeCents += f.feeCents;
      acc.costCents += f.cost.totalCents;
      acc.clientRevenue30d += f.clientRevenue30d;
      if (f.feeSource === "contrato") acc.contratos += 1;
      if (f.feeSource === "tabela") acc.estimadas += 1;
      if (f.cost.llmCents === null) acc.llmSemCambio = true;
      return acc;
    },
    { feeCents: 0, costCents: 0, clientRevenue30d: 0, contratos: 0, estimadas: 0, llmSemCambio: false },
  );
  const marginCents = t.feeCents - t.costCents;
  return { ...t, marginCents, marginPct: t.feeCents > 0 ? marginCents / t.feeCents : null };
}

/** Custos ainda zerados: a margem mostrada seria igual à receita. */
export function costsConfigured(s: CostSettings | undefined): boolean {
  return !!s && (s.chip_monthly_cents > 0 || s.infra_fixed_monthly_cents > 0 || s.usd_brl > 0);
}

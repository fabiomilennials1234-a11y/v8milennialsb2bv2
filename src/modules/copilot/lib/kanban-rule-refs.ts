/**
 * kanban-rule-refs — resolução client-side das regras por etapa (SCRUM-628, W3).
 *
 * Espelha `supabase/functions/_shared/copilot/kanban-rules.ts` (runtimes
 * separados — Deno e browser não compartilham módulo). Dois formatos vivos na
 * tabela `copilot_agent_kanban_rules`:
 *
 *   LEGADO → pipe_type = slug do funil, stage_name = stage_key.
 *   NOVO   → pipe_type = uuid do funil (`pipelines.id`),
 *            stage_name = uuid da etapa (`pipeline_stages.id`).
 *
 * A leitura aceita os dois; o salvamento da UI regrava sempre no formato novo.
 * `campanha` é outro eixo (não é funil); `upsell_*` está aposentado (Carteira
 * não é funil — SCRUM-618).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidRef(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export const CAMPAIGN_AXIS = "campanha";
export const RETIRED_AXES: ReadonlySet<string> = new Set(["upsell_base", "upsell_gestao"]);

/** Aliases legados que não são slug de funil nenhum (espelha o pipeline-adapter). */
const LEGACY_SLUG_ALIASES: Record<string, string> = {
  qualificacao: "whatsapp",
  pipe_whatsapp: "whatsapp",
  pipe_confirmacao: "confirmacao",
  pipe_propostas: "propostas",
};

export interface KanbanRuleRefLike {
  pipe_type: string;
  stage_name: string;
}

export interface FunnelLike {
  id: string;
  slug: string;
}

export interface FunnelStageLike {
  id: string;
  stage_key: string;
}

export function isCampaignRule(rule: KanbanRuleRefLike): boolean {
  return rule.pipe_type === CAMPAIGN_AXIS;
}

export function isFunnelRule(rule: KanbanRuleRefLike): boolean {
  return !isCampaignRule(rule) && !RETIRED_AXES.has(rule.pipe_type);
}

/** Resolve a ref de funil da regra contra a lista real de funis da org. */
export function resolveRuleFunnel<P extends FunnelLike>(
  rule: KanbanRuleRefLike,
  pipelines: readonly P[],
): P | null {
  const ref = (rule.pipe_type ?? "").trim();
  if (!ref) return null;
  if (isUuidRef(ref)) {
    return pipelines.find((p) => p.id.toLowerCase() === ref.toLowerCase()) ?? null;
  }
  const slug = ref.toLowerCase();
  return (
    pipelines.find((p) => p.slug.toLowerCase() === slug) ??
    (LEGACY_SLUG_ALIASES[slug]
      ? pipelines.find((p) => p.slug === LEGACY_SLUG_ALIASES[slug]) ?? null
      : null)
  );
}

/** Resolve a ref de etapa da regra contra as etapas do funil já resolvido. */
export function resolveRuleStage<S extends FunnelStageLike>(
  rule: KanbanRuleRefLike,
  stages: readonly S[],
): S | null {
  const ref = (rule.stage_name ?? "").trim();
  if (!ref) return null;
  if (isUuidRef(ref)) {
    return stages.find((s) => s.id.toLowerCase() === ref.toLowerCase()) ?? null;
  }
  const key = ref.toLowerCase();
  return stages.find((s) => s.stage_key.toLowerCase() === key) ?? null;
}

/** A regra referencia esta etapa (id OU stage_key, formatos novo e legado)? */
export function ruleMatchesStage(
  rule: KanbanRuleRefLike,
  stage: { id?: string | null; key?: string | null },
): boolean {
  const ref = (rule.stage_name ?? "").trim();
  if (!ref) return false;
  if (isUuidRef(ref)) {
    return !!stage.id && ref.toLowerCase() === stage.id.toLowerCase();
  }
  return !!stage.key && ref.toLowerCase() === stage.key.trim().toLowerCase();
}

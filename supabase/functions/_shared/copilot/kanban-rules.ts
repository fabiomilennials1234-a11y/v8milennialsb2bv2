/**
 * kanban-rules — resolução das regras por etapa do Copilot (SCRUM-628, W3).
 *
 * A tabela `copilot_agent_kanban_rules` guarda a referência da etapa em DUAS
 * colunas de texto, e há dois formatos vivos:
 *
 *   LEGADO  → pipe_type = slug do funil ("whatsapp", "confirmacao", ...),
 *             stage_name = stage_key da etapa. Medido em prod 2026-09-02:
 *             11 regras, TODAS neste formato, todas `pipe_type='whatsapp'`,
 *             100% resolvem contra o funil slug=whatsapp da org.
 *   NOVO    → pipe_type = UUID do funil (`pipelines.id`),
 *             stage_name = UUID da etapa (`pipeline_stages.id`).
 *
 * O formato novo sobrevive a rename de slug/stage_key; o legado continua sendo
 * aceito na LEITURA para sempre (configs salvas não quebram). A UI regrava no
 * formato novo ao salvar.
 *
 * `campanha` NÃO é funil — é outro eixo (campanha_leads/campanha_stages) e
 * continua casando por nome de etapa da campanha. `upsell_base`/`upsell_gestao`
 * deixaram de ser eixo de regra (SCRUM-618: Carteira não é funil; 0 regras em
 * prod). Regra legada nesses eixos é ignorada com log, nunca erro.
 *
 * Módulo PURO (sem DB) — quem resolve funil de verdade é o pipeline-adapter;
 * aqui só se classifica e casa referência.
 */

export interface KanbanRuleRef {
  pipe_type: string;
  stage_name: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidRef(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

/** Eixo que não é funil e tem matching próprio (nome da etapa da campanha). */
export const CAMPAIGN_AXIS = "campanha";

/** Eixos aposentados (Carteira não é funil — SCRUM-618). Regra aqui é ignorada. */
export const RETIRED_AXES: ReadonlySet<string> = new Set(["upsell_base", "upsell_gestao"]);

export function isCampaignRule(rule: KanbanRuleRef): boolean {
  return rule.pipe_type === CAMPAIGN_AXIS;
}

export function isRetiredAxisRule(rule: KanbanRuleRef): boolean {
  return RETIRED_AXES.has(rule.pipe_type);
}

/** Regra cujo pipe_type referencia um FUNIL (uuid ou slug — o adapter resolve os dois). */
export function isFunnelRule(rule: KanbanRuleRef): boolean {
  return !isCampaignRule(rule) && !isRetiredAxisRule(rule);
}

/**
 * Refs de funil distintas citadas pelas regras, na ordem em que aparecem.
 * A PRIMEIRA ref é o "funil primário" do agente — é nela que o auto-avanço por
 * turn opera quando o Sujeito tem negócio lá (decide-action).
 */
export function funnelRefsFromRules(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const rule of rules) {
    if (!rule || typeof rule.pipe_type !== "string") continue;
    if (!isFunnelRule(rule)) continue;
    const ref = rule.pipe_type.trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

/**
 * A regra casa com a etapa dada?
 *   formato novo   → stage_name é o UUID da etapa (compara com stage.id);
 *   formato legado → stage_name é a stage_key (case-insensitive, comportamento
 *                    histórico do build-prompt).
 */
export function ruleMatchesStage(
  rule: KanbanRuleRef,
  stage: { id?: string | null; key?: string | null },
): boolean {
  const ref = (rule.stage_name ?? "").trim();
  if (!ref) return false;
  if (isUuidRef(ref)) {
    return !!stage.id && ref.toLowerCase() === stage.id.toLowerCase();
  }
  return !!stage.key && ref.toLowerCase() === stage.key.trim().toLowerCase();
}

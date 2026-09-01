/**
 * Stage Role Classifier — deterministic core (#991, ADR-0017 §1, padrão ADR-0006).
 *
 * Orgs renomeiam etapas livremente e o stage_key é ruído legado — só o NOME
 * carrega significado (amendment do ADR-0006). Este módulo puro sugere o
 * `stage_role` (enum governado do #990) de uma etapa CUSTOM a partir do nome,
 * via mapa determinístico de sinônimos pt-BR. Nomes óbvios ("Fechado",
 * "Perdido", "Reunião marcada") resolvem sem IA; o LLM (edge function
 * `classify-stage-roles`) só entra para o resíduo não-determinístico.
 *
 * Semântica de aplicação (ADR-0017 §1 — won/lost = dinheiro):
 *   - meeting_booked / meeting_held  → auto-aplicam (update direto no role)
 *   - won / lost                     → NUNCA auto-aplicam; viram sugestão
 *     pendente (`suggested_stage_role`) até confirmação humana (tela master
 *     de revisão, ou escolha explícita do admin no modal de etapa).
 *
 * `is_final_positive` / `is_final_negative` entram apenas como SINAL de
 * fallback (sugerem won/lost quando o nome não resolve) — o role final nunca
 * é derivado automaticamente delas.
 *
 * Sem IO, sem side effects — o LLM e o write no banco vivem na edge function
 * (mesma separação do followup-stage-classifier, ADR-0006).
 *
 * TWIN: `src/modules/pipelines/lib/stage-role-classifier.ts` é o gêmeo
 * frontend (modal de etapa precisa de sugestão instantânea client-side).
 * Paridade pinada por `tests/unit/stage-role-classifier-twin.test.ts` —
 * mantenha em lockstep.
 */

export type StageRole =
  | "open"
  | "meeting_booked"
  | "meeting_held"
  | "won"
  | "lost";

/** Roles que o classifier pode sugerir — `open` é ausência de sugestão. */
export type SuggestableStageRole = Exclude<StageRole, "open">;

export type SuggestionSource = "deterministic" | "flag" | "ai";

export interface StageRoleSuggestion {
  role: SuggestableStageRole;
  source: SuggestionSource;
}

/**
 * Normaliza nome de etapa para matching: minúsculas, sem acentos, sem
 * emoji/pontuação, espaços colapsados. "Reunião Marcada ✓" → "reuniao marcada".
 */
export function normalizeStageName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Rule {
  role: SuggestableStageRole;
  pattern: RegExp;
}

/**
 * Mapa determinístico de sinônimos pt-BR (avaliado em ordem — a primeira
 * regra que casar vence).
 *
 * Ordem importa:
 *   1. Negações de comparecimento primeiro ("não compareceu" contém
 *      "compareceu" — sem isso viraria meeting_held).
 *   2. won antes de meeting_held ("venda realizada" é venda, não reunião).
 *   3. lost antes dos meeting_* (idem para "reunião perdida").
 */
const RULES: readonly Rule[] = [
  // ── won — fechado/ganhou/vendido/comprou/recomprou ─────────────────────
  { role: "won", pattern: /\b(fechado|fechada|fechou)\b/ },
  { role: "won", pattern: /\b(ganho|ganha|ganhou|ganhamos)\b/ },
  { role: "won", pattern: /\b(vendido|vendida|vendeu)\b/ },
  { role: "won", pattern: /\bvenda\s+(fechada|realizada|concluida|ganha)\b/ },
  { role: "won", pattern: /\b(comprou|recomprou|recompra)\b/ },
  { role: "won", pattern: /\bcontrato\s+(assinado|fechado)\b/ },

  // ── lost — perdido/desistiu/sem interesse ──────────────────────────────
  { role: "lost", pattern: /\b(perdido|perdida|perdeu|perdemos|perda)\b/ },
  { role: "lost", pattern: /\b(desistiu|desistencia|desqualificado|desqualificada)\b/ },
  { role: "lost", pattern: /\b(sem|nao\s+tem)\s+interesse\b/ },
  { role: "lost", pattern: /\b(recusou|recusado|recusada|declinou|churn)\b/ },

  // ── meeting_held — compareceu/realizada ────────────────────────────────
  { role: "meeting_held", pattern: /\b(compareceu|comparecimento)\b/ },
  {
    role: "meeting_held",
    pattern: /\b(reuniao|call|visita|demo|apresentacao)\s+(realizada|feita|concluida|aconteceu)\b/,
  },
  { role: "meeting_held", pattern: /\b(realizada|realizado)\b/ },

  // ── meeting_booked — reunião marcada/agendada ──────────────────────────
  { role: "meeting_booked", pattern: /\b(agendado|agendada|agendamento)\b/ },
  {
    role: "meeting_booked",
    pattern: /\b(reuniao|call|visita|demo|apresentacao)\s+(marcada|agendada|confirmada)\b/,
  },
  { role: "meeting_booked", pattern: /\bmarcou\s+(reuniao|call|visita|demo)\b/ },
] as const;

/**
 * Nomes que VETAM qualquer sugestão — o classificador devolve `null` e a etapa
 * fica com o `open` que já é o padrão.
 *
 * Estes dois padrões existiam como `{ role: "lost" }` e essa era a redação
 * errada de uma intenção certa. A intenção: "não compareceu" contém
 * "compareceu", então precisa ser decidido ANTES da regra de `meeting_held`,
 * senão vira reunião realizada. O erro: resolver isso chamando a falta de
 * PERDA.
 *
 * Falta não é perda. O enum diz:
 *   open = "não gera métrica de reunião nem de venda"
 *   lost = "encerra a oportunidade sem venda — conta como perda"
 * Quem faltou não encerrou nada — segue vivo e precisa de nova data. Medido em
 * prod: 140 leads da Milennials contavam como perdidos por terem faltado.
 *
 * 🚨 O veto corta o classificador INTEIRO, não só a etapa do nome. As duas
 * linhas erradas em prod tinham `is_final_negative = true` junto, e o fallback
 * de flag em `classifyStageRole` devolve `lost` por conta própria — vetar só o
 * nome deixaria a flag reconduzir ao mesmo destino.
 *
 * `SuggestableStageRole` é `Exclude<StageRole, "open">`: sugerir `open` é
 * impossível por tipo, e é por isso que isto é um veto e não mais uma regra.
 */
const VETOS: readonly RegExp[] = [
  /\b(nao|sem)\s+(compareceu|comparecimento)\b/,
  /\bno\s?show\b/,
];

/** O nome é uma falta — nenhuma sugestão vale, nem a vinda de flag. */
export function nomeVetaSugestao(name: string): boolean {
  const normalized = normalizeStageName(name);
  if (!normalized) return false;
  return VETOS.some((v) => v.test(normalized));
}

/**
 * Classificação determinística pelo NOME. `null` = nome não-óbvio (candidato
 * ao fallback de flag e/ou à IA).
 */
export function classifyStageNameDeterministic(
  name: string,
): SuggestableStageRole | null {
  const normalized = normalizeStageName(name);
  if (!normalized) return null;
  if (nomeVetaSugestao(name)) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(normalized)) return rule.role;
  }
  return null;
}

export interface StageClassifierInput {
  name: string;
  isFinalPositive?: boolean;
  isFinalNegative?: boolean;
}

/**
 * Classificador completo: nome (determinístico) → flags de board (sinal
 * fraco, fallback). Nome sempre vence a flag. `null` = sem sugestão
 * determinística (resíduo pra IA).
 */
export function classifyStageRole(
  input: StageClassifierInput,
): StageRoleSuggestion | null {
  // Antes de tudo: falta não vira sugestão nenhuma — nem pelo nome, nem pela
  // flag de board logo abaixo. Ver `VETOS`.
  if (nomeVetaSugestao(input.name)) return null;
  const byName = classifyStageNameDeterministic(input.name);
  if (byName) return { role: byName, source: "deterministic" };
  if (input.isFinalPositive) return { role: "won", source: "flag" };
  if (input.isFinalNegative) return { role: "lost", source: "flag" };
  return null;
}

export type StageRoleAction = "auto_apply" | "queue_review";

/**
 * Semântica de aplicação de uma sugestão (ADR-0017 §1):
 * meeting_* auto-aplica; won/lost = dinheiro = fila de revisão humana. SEMPRE.
 */
export function decideStageRoleAction(role: SuggestableStageRole): StageRoleAction {
  return role === "won" || role === "lost" ? "queue_review" : "auto_apply";
}

// ── Chaves de sistema ───────────────────────────────────────────────────────
// Espelho TS do conjunto coberto por `public.system_stage_role()` (#990) +
// chaves de sistema com role 'open' (indistinguíveis de custom só pelo role).
// Fonte: seeds `create_default_pipeline_stages` + funil mergeado (ADR-0004).
// O classifier NUNCA toca etapa de sistema — role dela é governado pelo mapa
// determinístico SQL (renomear etapa não muda métrica, ADR-0017).

const SYSTEM_STAGE_KEYS: Record<string, readonly string[]> = {
  whatsapp: [
    "novo",
    "abordado",
    "respondeu",
    "esfriou",
    "agendado",
    "remarcar",
    "compareceu",
    "nao_compareceu",
  ],
  confirmacao: [
    "reuniao_marcada",
    "confirmar_d5",
    "confirmar_d3",
    "confirmar_d2",
    "confirmar_d1",
    "confirmacao_no_dia",
    "remarcar",
    "compareceu",
    "perdido",
  ],
  propostas: [
    "marcar_compromisso",
    "reativar",
    "compromisso_marcado",
    "proposta_enviada",
    "esfriou",
    "futuro",
    "vendido",
    "perdido",
  ],
  upsell_base: ["0-3m", "3-6m", "6-9m", "9-12m", "12-18m", "18m+"],
  upsell_gestao: ["campeoes", "fieis", "primeira_compra", "em_risco", "inativos"],
};

export function isSystemStageKey(pipelineType: string, stageKey: string): boolean {
  return SYSTEM_STAGE_KEYS[pipelineType]?.includes(stageKey) ?? false;
}

// ── Plano de classificação (puro — consumido pela edge function) ────────────

export interface StageToClassify {
  id: string;
  pipelineType: string;
  stageKey: string;
  name: string;
  isFinalPositive?: boolean;
  isFinalNegative?: boolean;
}

export interface StagePlanItem {
  id: string;
  role: SuggestableStageRole;
  action: StageRoleAction;
  source: SuggestionSource;
}

export interface StageRolePlan {
  items: StagePlanItem[];
  /** Etapas custom sem resolução determinística/flag/IA — resíduo. */
  unresolved: StageToClassify[];
  /** Etapas de sistema ignoradas (role governado pelo mapa SQL do #990). */
  skippedSystem: number;
}

/**
 * Monta o plano de sugestões para um lote de etapas.
 *
 * `aiClassification` (opcional) mapeia stage id → role sugerido pelo LLM para
 * o resíduo não-determinístico. Precedência: nome > flag > IA. Etapas de
 * sistema nunca entram no plano. A decisão auto_apply/queue_review sai de
 * `decideStageRoleAction` — won/lost jamais aparecem como auto_apply, por
 * construção.
 */
export function planStageRoleSuggestions(
  stages: readonly StageToClassify[],
  aiClassification: Record<string, SuggestableStageRole | null> = {},
): StageRolePlan {
  const items: StagePlanItem[] = [];
  const unresolved: StageToClassify[] = [];
  let skippedSystem = 0;

  for (const stage of stages) {
    if (isSystemStageKey(stage.pipelineType, stage.stageKey)) {
      skippedSystem++;
      continue;
    }

    const deterministic = classifyStageRole({
      name: stage.name,
      isFinalPositive: stage.isFinalPositive,
      isFinalNegative: stage.isFinalNegative,
    });

    const suggestion: StageRoleSuggestion | null = deterministic ??
      (aiClassification[stage.id]
        ? { role: aiClassification[stage.id]!, source: "ai" }
        : null);

    if (!suggestion) {
      unresolved.push(stage);
      continue;
    }

    items.push({
      id: stage.id,
      role: suggestion.role,
      action: decideStageRoleAction(suggestion.role),
      source: suggestion.source,
    });
  }

  return { items, unresolved, skippedSystem };
}

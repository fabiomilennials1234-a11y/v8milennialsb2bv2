/**
 * Plano de ações de UM turno do Copilot V1 — módulo PURO (zero IO, zero `this`).
 *
 * Por que existe: o LLM devolve N tool_calls numa resposta, e o engine só
 * executava a primeira não-mídia (as demais eram descartadas — em prod,
 * [update_lead, advance_stage, transfer_to_human] virava só update_lead).
 * Aqui a resposta inteira vira um plano determinístico:
 *
 *   1. Partição: mídia (SEND_DOCUMENT, SEND_PRODUCT_MATERIAL) → `media`, na
 *      ordem do LLM, sem dedupe (chave de idempotência por document/material).
 *   2. Inline remanescente (SEARCH_KNOWLEDGE / GENERATE_ORDER_REQUEST) numa
 *      resposta final → `dropped: inline_only` (são executadas no loop do LLM).
 *   3. Dedupe por tipo, 1ª ocorrência vence. TRANSFER_HUMAN e TRANSFER_SZ_CHAT
 *      são uma família: só a 1ª transferência sobrevive.
 *   4. QUALIFY_LEAD + DISQUALIFY_LEAD no mesmo turno → descarta AMBAS (o efeito
 *      delas é via estado → automation_actions; sinal contraditório não autoriza
 *      efeito irreversível).
 *   5. Ordem total por rank (RANK abaixo); transferência sempre por último.
 *
 * Por cima do plano, `applyStageHandoff` garante handoff determinístico quando o
 * turno move o lead para uma etapa configurada em
 * `copilot_agents.intent_detection.stage_handoff`.
 */

import { determineNextState } from "../../_shared/copilot/state-machine.ts";

export type TurnActionOrigin = "llm" | "recovered" | "fallback" | "synthesized";

export type TurnAction = {
  action: string;
  params: Record<string, unknown>;
  tenant_id: string;
  toolName: string;
  origin: TurnActionOrigin;
};

export type DropReason =
  | "duplicate"
  | "transfer_family_duplicate"
  | "conflict_qualify_disqualify"
  | "inline_only";

export interface ActionPlan {
  sequential: TurnAction[];
  media: TurnAction[];
  dropped: Array<{ action: string; reason: DropReason }>;
}

export interface StageHandoffPolicy {
  version: 1;
  stages: Array<{ stage_key: string; pipe?: string }>;
}

export interface StageHandoffContext {
  organizationId: string;
  userMessage: string;
  notifyPhones: string[] | null;
  currentStageKeys?: Array<{ pipeline_slug?: string; pipeline_id?: string; stage_key: string }>;
}

const MEDIA_ACTIONS = new Set(["SEND_DOCUMENT", "SEND_PRODUCT_MATERIAL"]);
const INLINE_ONLY_ACTIONS = new Set(["SEARCH_KNOWLEDGE", "GENERATE_ORDER_REQUEST"]);
const TRANSFER_FAMILY = new Set(["TRANSFER_HUMAN", "TRANSFER_SZ_CHAT"]);

const UNKNOWN_RANK = 9;
const RANK: Record<string, number> = {
  CREATE_CUSTOM_FIELD: 0, // o campo precisa existir antes de ser preenchido
  UPDATE_LEAD: 1,
  UPDATE_QUALIFICATION_SCORE: 2,
  QUALIFY_LEAD: 3,
  DISQUALIFY_LEAD: 3,
  ADVANCE_STAGE: 4,
  ADVANCE_CONFIRMATION_STAGE: 5,
  SCHEDULE_MEETING: 6,
  CONFIRM_MEETING: 7,
  CREATE_LEAD: 8,
  UPDATE_CRM: 8,
  TRANSFER_HUMAN: 10,
  TRANSFER_SZ_CHAT: 10,
};

/** Inverso de `mapToolToAction` (dispatcher) — o único nome não-trivial é o da transferência. */
export function toolNameForAction(action: string): string {
  if (action === "TRANSFER_HUMAN") return "transfer_to_human";
  return action.toLowerCase();
}

function rankOf(action: string): number {
  return RANK[action] ?? UNKNOWN_RANK;
}

/** Desconhecidos (`UNKNOWN`) de tools diferentes não colapsam entre si. */
function dedupeKey(a: TurnAction): string {
  return a.action === "UNKNOWN" ? `UNKNOWN:${a.toolName}` : a.action;
}

export function planTurnActions(calls: TurnAction[]): ActionPlan {
  const media: TurnAction[] = [];
  const dropped: ActionPlan["dropped"] = [];
  const kept: TurnAction[] = [];
  const seen = new Set<string>();
  let transferSeen = false;

  for (const c of calls) {
    if (MEDIA_ACTIONS.has(c.action)) {
      media.push(c);
      continue;
    }
    if (INLINE_ONLY_ACTIONS.has(c.action)) {
      dropped.push({ action: c.action, reason: "inline_only" });
      continue;
    }
    const key = dedupeKey(c);
    if (seen.has(key)) {
      dropped.push({ action: c.action, reason: "duplicate" });
      continue;
    }
    if (TRANSFER_FAMILY.has(c.action)) {
      if (transferSeen) {
        dropped.push({ action: c.action, reason: "transfer_family_duplicate" });
        continue;
      }
      transferSeen = true;
    }
    seen.add(key);
    kept.push(c);
  }

  let sequential = kept;
  if (seen.has("QUALIFY_LEAD") && seen.has("DISQUALIFY_LEAD")) {
    sequential = kept.filter((a) => a.action !== "QUALIFY_LEAD" && a.action !== "DISQUALIFY_LEAD");
    dropped.push(
      { action: "QUALIFY_LEAD", reason: "conflict_qualify_disqualify" },
      { action: "DISQUALIFY_LEAD", reason: "conflict_qualify_disqualify" },
    );
  }

  // Array.prototype.sort é estável (ES2019): empate de rank preserva a ordem do LLM.
  sequential = [...sequential].sort((a, b) => rankOf(a.action) - rankOf(b.action));

  return { sequential, media, dropped };
}

// ─── Política de etapa de handoff ───────────────────────────────────────────

const STAGE_KEY_RE = /^[a-z0-9_]{1,64}$/;
// pipe aceita slug OU uuid do funil (o uuid traz hífens).
const PIPE_RE = /^[a-z0-9_-]{1,64}$/;
const MAX_POLICY_STAGES = 20;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse defensivo de `intent_detection.stage_handoff`. Qualquer desvio do
 * contrato → null (política desligada). Nunca lança.
 */
export function parseStageHandoffPolicy(raw: unknown): StageHandoffPolicy | null {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== 1) return null;
  const stages = raw.stages;
  if (!Array.isArray(stages) || stages.length === 0 || stages.length > MAX_POLICY_STAGES) return null;

  const out: StageHandoffPolicy["stages"] = [];
  for (const s of stages) {
    if (!isPlainObject(s)) return null;
    if (typeof s.stage_key !== "string") return null;
    const stageKey = s.stage_key.trim().toLowerCase();
    if (!STAGE_KEY_RE.test(stageKey)) return null;
    if (s.pipe === undefined || s.pipe === null) {
      out.push({ stage_key: stageKey });
      continue;
    }
    if (typeof s.pipe !== "string") return null;
    const pipe = s.pipe.trim().toLowerCase();
    if (!PIPE_RE.test(pipe)) return null;
    out.push({ stage_key: stageKey, pipe });
  }
  return { version: 1, stages: out };
}

/** Mesma normalização de `moveStage` (trim + lowercase). */
function norm(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

function oneLine(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

function clip(v: string, max: number): string {
  return v.length <= max ? v : `${v.slice(0, max - 1)}…`;
}

const MAX_SUMMARY_MESSAGE = 280;
const MAX_SUMMARY_DATA = 300;

/**
 * "k=v; …" dos campos que o UPDATE_LEAD do MESMO plano grava. Fonte = dado do
 * turno (params da tool), nunca texto do assistente nem `<thinking>`.
 */
function describeLeadUpdates(plan: ActionPlan): string {
  const update = plan.sequential.find((a) => a.action === "UPDATE_LEAD");
  if (!update) return "";
  const source = isPlainObject(update.params.updates) ? update.params.updates : update.params;
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(source)) {
    if (k === "lead_id" || k === "updates" || v === undefined || v === null) continue;
    const value = typeof v === "string" ? v : JSON.stringify(v);
    pairs.push(`${oneLine(k)}=${oneLine(value)}`);
  }
  return clip(pairs.join("; "), MAX_SUMMARY_DATA);
}

function isLeadAlreadyThere(
  pipe: string,
  stage: string,
  current: StageHandoffContext["currentStageKeys"],
): boolean {
  if (!current || !pipe) return false;
  return current.some((pos) =>
    norm(pos.stage_key) === stage &&
    (norm(pos.pipeline_slug) === pipe || norm(pos.pipeline_id) === pipe)
  );
}

/**
 * Sintetiza TRANSFER_HUMAN quando o plano move o lead (ADVANCE_STAGE) para uma
 * etapa da política e o LLM não transferiu. Anti-loop: lead que já está na
 * etapa-alvo daquele funil não re-dispara o handoff.
 *
 * Não depende de `can_transfer_human` — a política é opt-in explícito e mais
 * específica. Retorna um plano NOVO; o de entrada não é mutado.
 */
export function applyStageHandoff(
  plan: ActionPlan,
  policy: StageHandoffPolicy | null,
  ctx: StageHandoffContext,
): { plan: ActionPlan; synthesized: TurnAction | null } {
  const none = { plan, synthesized: null };
  if (!policy) return none;
  if (plan.sequential.some((a) => TRANSFER_FAMILY.has(a.action))) return none;

  const advance = plan.sequential.find((a) => a.action === "ADVANCE_STAGE");
  if (!advance) return none;

  const stage = norm(advance.params.target_stage);
  // target_pipe ausente → "whatsapp": mesmo default do worker (move-card.ts,
  // dispatcher.ts). Sem isso o casamento e o anti-loop olhariam um funil vazio.
  const pipe = norm(advance.params.target_pipe) || "whatsapp";
  if (!stage) return none;

  const matches = policy.stages.some((s) =>
    s.stage_key === stage && (s.pipe === undefined || s.pipe === pipe)
  );
  if (!matches) return none;
  if (isLeadAlreadyThere(pipe, stage, ctx.currentStageKeys)) return none;

  const message = clip(oneLine(ctx.userMessage ?? ""), MAX_SUMMARY_MESSAGE);
  const data = describeLeadUpdates(plan);
  const summary =
    `Lead avançou para ${stage} (funil ${pipe}). Última mensagem do lead: "${message}".` +
    (data ? ` Dados atualizados no turno: ${data}` : "");

  const params: Record<string, unknown> = {
    reason: `Etapa de handoff atingida: ${stage} (funil ${pipe})`,
    priority: "ALTA",
    priority_reason: "stage_handoff",
    summary,
  };
  if (Array.isArray(ctx.notifyPhones) && ctx.notifyPhones.length > 0) {
    params.notify_phones = [...ctx.notifyPhones];
  }

  const synthesized: TurnAction = {
    action: "TRANSFER_HUMAN",
    params,
    tenant_id: ctx.organizationId,
    toolName: toolNameForAction("TRANSFER_HUMAN"),
    origin: "synthesized",
  };

  return {
    plan: { ...plan, sequential: [...plan.sequential, synthesized], dropped: [...plan.dropped] },
    synthesized,
  };
}

// ─── Segurança: destino do resumo de handoff ────────────────────────────────

function digits(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * `notify_phones` vem do LLM — prompt injection poderia mandar o resumo (PII)
 * para número arbitrário. Restringe à allowlist do agente
 * (`handoff_notify_phones`): interseção por dígitos; vazia → allowlist inteira;
 * allowlist ausente/vazia → undefined (não há para quem notificar).
 * Devolve sempre a forma da ALLOWLIST (fonte confiável), sem duplicatas.
 */
export function constrainNotifyPhones(requested: unknown, allowlist: string[] | null): string[] | undefined {
  if (!Array.isArray(allowlist)) return undefined;
  const allowed = allowlist.filter((p): p is string => typeof p === "string" && digits(p).length > 0);
  if (allowed.length === 0) return undefined;

  const wanted = new Set(
    Array.isArray(requested)
      ? requested.filter((p): p is string => typeof p === "string").map(digits).filter(Boolean)
      : [],
  );
  const picked: string[] = [];
  const pickedDigits = new Set<string>();
  for (const phone of allowed) {
    const d = digits(phone);
    if (wanted.has(d) && !pickedDigits.has(d)) {
      pickedDigits.add(d);
      picked.push(phone);
    }
  }
  return picked.length > 0 ? picked : [...allowed];
}

// ─── Estado e âncora ────────────────────────────────────────────────────────

/**
 * Fold de `determineNextState` sobre o plano (inclui a sintetizada).
 * `visitedStates` = estados distintos alcançados, na ordem; plano vazio
 * visita só o estado atual (comportamento anterior: automação avaliada sobre
 * o estado do turno).
 */
export function foldNextState(current: string, plan: ActionPlan): { nextState: string; visitedStates: string[] } {
  let state = current;
  const visited: string[] = [];
  for (const a of plan.sequential) {
    state = determineNextState(state, a.toolName);
    if (!visited.includes(state)) visited.push(state);
  }
  if (visited.length === 0) visited.push(state);
  return { nextState: state, visitedStates: visited };
}

/**
 * Âncora do auto-avanço de etapa por turno: ADVANCE_STAGE explícito vence;
 * senão SCHEDULE_MEETING; senão a ação principal.
 */
export function stageAnchor(plan: ActionPlan): TurnAction | null {
  return plan.sequential.find((a) => a.action === "ADVANCE_STAGE") ??
    plan.sequential.find((a) => a.action === "SCHEDULE_MEETING") ??
    plan.sequential[0] ??
    plan.media[0] ??
    null;
}

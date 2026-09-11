/**
 * Um turno do Oráculo, da requisição à resposta.
 *
 * A ordem importa e é a decisão do ADR-0032 §4 em código: o Escopo sai do JWT
 * ANTES de qualquer leitura, e o corpo da requisição nunca é ouvido sobre
 * organização. Quem pergunta define O QUE quer saber; o servidor define O QUE
 * ele alcança.
 */

import { type OracleActor, type OraclePermissions, resolveScope } from "./scope.ts";
import { buildTurnContext, type Turn } from "./memory.ts";
import { checkQuota } from "./quota.ts";
import { type Llm, type OracleTool, runTurn, type TurnResult } from "./loop.ts";
import { buildProfileQuestions } from "./profile-questions.ts";

/** Últimos turnos que vão na íntegra ao modelo. */
export const KEEP_LAST_TURNS = 8;

export interface ConversationState {
  id: string;
  summary: string | null;
  history: Turn[];
  lastMessageAt?: string | null;
}

export interface TurnStore {
  turnsToday(userId: string): Promise<number>;
  orgLimit(organizationId: string): Promise<number | null>;
  loadConversation(actor: OracleActor, conversationId: string | null): Promise<ConversationState>;
  loadProfileContext(actor: OracleActor): Promise<string | null>;
  loadInterviewState(actor: OracleActor, conversationId: string): Promise<{
    askedKeys: string[];
    questionCount: number;
  }>;
  saveTurn(args: {
    conversation: ConversationState;
    actor: OracleActor;
    pergunta: string;
    resultado: TurnResult;
    summary?: string | null;
  }): Promise<string>;
}

export interface TurnDeps {
  auth(req: Request, body: Record<string, unknown>): Promise<OracleActor>;
  perms(actor: OracleActor): Promise<OraclePermissions>;
  llm: Llm;
  tools: OracleTool[];
  store: TurnStore;
}

export async function handleTurn(
  req: Request,
  deps: TurnDeps,
  cors: Record<string, string>,
): Promise<Response> {
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  const body = (await req.json()) as Record<string, unknown>;
  const pergunta = typeof body.pergunta === "string" ? body.pergunta.trim() : "";
  if (!pergunta) return json(400, { error: "pergunta_vazia" });

  const actor = await deps.auth(req, body);
  const perms = await deps.perms(actor);
  const scope = resolveScope(actor, perms);

  const quota = checkQuota({
    turnsToday: await deps.store.turnsToday(actor.userId),
    orgLimit: await deps.store.orgLimit(actor.organizationId),
  });
  if (!quota.allowed) {
    return json(429, { error: "limite_diario", limite: quota.limit });
  }

  const conversationId = typeof body.conversa_id === "string" ? body.conversa_id : null;
  const conversation = await deps.store.loadConversation(actor, conversationId);
  const [profileLoad, interviewLoad] = await Promise.allSettled([
    deps.store.loadProfileContext(actor),
    deps.store.loadInterviewState(actor, conversation.id),
  ]);
  const profileContext = profileLoad.status === "fulfilled" ? profileLoad.value : null;
  const interview = interviewLoad.status === "fulfilled"
    ? interviewLoad.value
    : { askedKeys: [], questionCount: 3 };
  if (profileLoad.status === "rejected" || interviewLoad.status === "rejected") {
    console.warn("[oraculo] perfil opcional indisponível; análise principal preservada");
  }

  const contexto = buildTurnContext({
    history: [...conversation.history, { role: "user", content: pergunta }],
    summary: conversation.summary,
    keepLastTurns: KEEP_LAST_TURNS,
  });

  const inferenceStartedAt = Date.now();
  let summary = contexto.summary;
  let summaryTokens = { input: 0, output: 0 };
  if (contexto.evicted.length > 0) {
    const compacted = await deps.llm.complete({
      messages: contexto.evicted,
      summary,
      toolResults: [],
      purpose: "summary",
    });
    if (!compacted.text?.trim()) {
      throw new Error("Não foi possível atualizar a memória do Oráculo.");
    }
    summary = compacted.text.trim();
    summaryTokens = { input: compacted.inputTokens, output: compacted.outputTokens };
  }

  const resultado = await runTurn({
    llm: deps.llm,
    tools: deps.tools,
    scope,
    messages: contexto.messages,
    summary,
    profileContext,
  });
  resultado.profileQuestions = buildProfileQuestions({
    evidence: resultado.toolEvidence,
    askedKeys: interview.askedKeys,
    room: 3 - interview.questionCount,
  });
  resultado.telemetry.latencyMs = Date.now() - inferenceStartedAt;
  resultado.telemetry.inputTokens += summaryTokens.input;
  resultado.telemetry.outputTokens += summaryTokens.output;

  const assistantTurnId = await deps.store.saveTurn({
    conversation,
    actor,
    pergunta,
    resultado,
    summary,
  });

  return json(200, {
    conversa_id: conversation.id,
    turno_id: assistantTurnId,
    resposta: resultado.text,
    // A resposta diz de onde veio. Sem isso, "o Oráculo disse" não é auditável.
    procedencia: resultado.toolsUsed,
    teto_de_ferramentas_atingido: resultado.hitToolCeiling,
    restantes_hoje: quota.remaining - 1,
    propostas: resultado.proposals.map((proposal) => ({ ...proposal, status: "pending" })),
    perguntas_perfil: resultado.profileQuestions,
  });
}

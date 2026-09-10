/** Fronteira HTTP do feedback do Oráculo. Toda identidade nasce do JWT. */

import type { OracleActor } from "./scope.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FEEDBACK_REASONS = [
  "wrong_number",
  "misunderstood",
  "too_obvious",
  "not_actionable",
  "invented",
] as const;

export type FeedbackReason = typeof FEEDBACK_REASONS[number];
export type FeedbackRating = "positive" | "negative";
export type FeedbackTarget = "response" | "conversation";

export interface SubmitFeedbackInput {
  target: FeedbackTarget;
  rating: FeedbackRating;
  reason: FeedbackReason | null;
  comment: string | null;
  turnId: string | null;
  conversationId: string | null;
}

export interface SignalInput {
  event: "briefing_opened" | "proposal_clicked";
  proposalId: string | null;
  conversationId: string | null;
}

export interface FeedbackDeps {
  auth(req: Request, body: Record<string, unknown>): Promise<OracleActor>;
  submit(
    actor: OracleActor,
    input: SubmitFeedbackInput,
  ): Promise<{ id: string; alertId: string | null }>;
  notifyNow(alertId: string): Promise<boolean>;
  state(actor: OracleActor, conversationId: string): Promise<unknown>;
  signal(actor: OracleActor, input: SignalInput): Promise<void>;
  listCases(actor: OracleActor, limit: number): Promise<unknown[]>;
  getCase(actor: OracleActor, id: string): Promise<unknown | null>;
}

export async function handleFeedback(
  req: Request,
  deps: FeedbackDeps,
  cors: Record<string, string>,
): Promise<Response> {
  const json = (status: number, payload?: unknown) =>
    new Response(payload === undefined ? null : JSON.stringify(payload), {
      status,
      headers: payload === undefined ? cors : { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return json(204);
  if (req.method !== "POST") return json(405, { error: "metodo_invalido" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "json_invalido" });
  }

  const actor = await deps.auth(req, body);
  const action = body.acao;

  if (action === "avaliar") {
    const input = parseFeedback(body);
    if (!input) return json(400, { error: "avaliacao_invalida" });
    const saved = await deps.submit(actor, input);
    const sent = saved.alertId ? await deps.notifyNow(saved.alertId).catch(() => false) : undefined;
    return json(201, {
      id: saved.id,
      ...(sent === undefined ? {} : { alerta_enviado: sent }),
    });
  }

  if (action === "estado") {
    const conversationId = string(body.conversa_id);
    if (!UUID.test(conversationId)) return json(400, { error: "conversa_invalida" });
    return json(200, await deps.state(actor, conversationId));
  }

  if (action === "sinal") {
    const input = parseSignal(body);
    if (!input) return json(400, { error: "sinal_invalido" });
    await deps.signal(actor, input);
    return json(204);
  }

  if (action === "listar") {
    if (!actor.isMaster) return json(403, { error: "master_required" });
    const requested = Number(body.limite ?? 50);
    const limit = Number.isInteger(requested) ? Math.max(1, Math.min(requested, 100)) : 50;
    return json(200, { casos: await deps.listCases(actor, limit) });
  }

  if (action === "detalhe") {
    if (!actor.isMaster) return json(403, { error: "master_required" });
    const id = string(body.feedback_id);
    if (!UUID.test(id)) return json(400, { error: "feedback_invalido" });
    const detail = await deps.getCase(actor, id);
    return detail ? json(200, { caso: detail }) : json(404, { error: "feedback_nao_encontrado" });
  }

  return json(400, { error: "acao_invalida" });
}

function parseFeedback(body: Record<string, unknown>): SubmitFeedbackInput | null {
  const target = body.alvo === "resposta"
    ? "response"
    : body.alvo === "conversa"
    ? "conversation"
    : null;
  const rating = body.avaliacao === "positiva"
    ? "positive"
    : body.avaliacao === "negativa"
    ? "negative"
    : null;
  if (!target || !rating) return null;

  const reason =
    typeof body.motivo === "string" && FEEDBACK_REASONS.includes(body.motivo as FeedbackReason)
      ? body.motivo as FeedbackReason
      : null;
  if (rating === "negative" && !reason) return null;
  if (rating === "positive" && body.motivo !== undefined) return null;

  const comment = typeof body.comentario === "string" ? body.comentario.trim() : "";
  if (comment.length > 2000) return null;
  const turnId = string(body.turno_id);
  const conversationId = string(body.conversa_id);
  if (target === "response" && !UUID.test(turnId)) return null;
  if (target === "conversation" && !UUID.test(conversationId)) return null;

  return {
    target,
    rating,
    reason,
    comment: comment || null,
    turnId: target === "response" ? turnId : null,
    conversationId: target === "conversation" ? conversationId : null,
  };
}

function parseSignal(body: Record<string, unknown>): SignalInput | null {
  const event = body.evento;
  if (event !== "briefing_opened" && event !== "proposal_clicked") return null;
  const proposalId = string(body.proposta_id);
  const conversationId = string(body.conversa_id);
  if (event === "proposal_clicked" && !UUID.test(proposalId)) return null;
  if (conversationId && !UUID.test(conversationId)) return null;
  return {
    event,
    proposalId: event === "proposal_clicked" ? proposalId : null,
    conversationId: conversationId || null,
  };
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

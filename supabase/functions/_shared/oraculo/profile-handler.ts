/** Fronteira HTTP do perfil da operação. Organização e autoria vêm do JWT. */

import type { OracleActor } from "./scope.ts";
import { PROFILE_QUESTION_KEYS, type ProfileQuestionKey } from "./profile-questions.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ANSWER = 2_000;

export interface ProfileResponseInput {
  questionId: string;
  answer: string;
  skip: boolean;
}

export interface ProfileAdjustmentInput {
  teamMemberId: string;
  questionKey: ProfileQuestionKey;
  answer: string;
}

export interface ProfileDeps {
  auth(req: Request, body: Record<string, unknown>): Promise<OracleActor>;
  list(actor: OracleActor): Promise<unknown[]>;
  respond(actor: OracleActor, input: ProfileResponseInput): Promise<unknown>;
  saveOwn(
    actor: OracleActor,
    input: Omit<ProfileAdjustmentInput, "teamMemberId">,
  ): Promise<unknown>;
  adjust(actor: OracleActor, input: ProfileAdjustmentInput): Promise<unknown>;
}

export async function handleProfile(
  req: Request,
  deps: ProfileDeps,
  cors: Record<string, string>,
): Promise<Response> {
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method !== "POST") return json(405, { error: "metodo_nao_permitido" });

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json(400, { error: "corpo_invalido" });
  }

  const action = typeof body.acao === "string" ? body.acao : "";
  if (!["listar", "responder", "ignorar", "editar", "ajustar"].includes(action)) {
    return json(400, { error: "acao_invalida" });
  }
  const actor = await deps.auth(req, body);

  if (action === "listar") return json(200, { perfis: await deps.list(actor) });

  if (action === "responder" || action === "ignorar") {
    const questionId = typeof body.pergunta_id === "string" ? body.pergunta_id : "";
    if (!UUID.test(questionId)) return json(400, { error: "pergunta_invalida" });
    const skip = action === "ignorar";
    const answer = skip ? "" : cleanAnswer(body.resposta);
    if (!skip && !answer) return json(400, { error: "resposta_invalida" });
    return json(200, await deps.respond(actor, { questionId, answer, skip }));
  }

  const questionKey = typeof body.chave === "string" && isQuestionKey(body.chave)
    ? body.chave
    : null;
  const answer = cleanAnswer(body.resposta);
  if (action === "editar") {
    if (!questionKey || !answer) return json(400, { error: "edicao_invalida" });
    return json(200, await deps.saveOwn(actor, { questionKey, answer }));
  }

  if (!actor.isAdmin) return json(403, { error: "permissao_recusada" });
  const teamMemberId = typeof body.membro_id === "string" ? body.membro_id : "";
  if (!UUID.test(teamMemberId) || !questionKey || !answer) {
    return json(400, { error: "ajuste_invalido" });
  }
  return json(200, await deps.adjust(actor, { teamMemberId, questionKey, answer }));
}

function cleanAnswer(value: unknown): string {
  if (typeof value !== "string") return "";
  const answer = value.trim();
  return answer.length <= MAX_ANSWER ? answer : "";
}

function isQuestionKey(value: string): value is ProfileQuestionKey {
  return (PROFILE_QUESTION_KEYS as readonly string[]).includes(value);
}

/** Fronteira HTTP da confirmação humana de uma proposta do Oráculo. */
import type { OracleActor } from "./scope.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ActionExecutionResult {
  status: "sucesso" | "aviso";
  previstos?: number;
  qualificaveis_no_clique?: number;
  alterados: number;
  ja_tratados?: number;
  codigo?: string;
}

interface ActionDeps {
  auth(req: Request, body: Record<string, unknown>): Promise<OracleActor>;
  execute(actor: OracleActor, proposalId: string): Promise<ActionExecutionResult>;
}

export class ActionExecutionError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = "ActionExecutionError";
  }
}

export async function handleAction(
  req: Request,
  deps: ActionDeps,
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

  const proposalId = typeof body.proposta_id === "string" ? body.proposta_id : "";
  if (!UUID.test(proposalId)) return json(400, { error: "proposta_invalida" });

  try {
    const actor = await deps.auth(req, body);
    return json(200, await deps.execute(actor, proposalId));
  } catch (error) {
    if (error instanceof ActionExecutionError) return json(error.status, { error: error.code });
    throw error;
  }
}

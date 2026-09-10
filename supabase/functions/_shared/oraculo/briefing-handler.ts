import type { OracleActor } from "./scope.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminBriefingDeps {
  auth(req: Request, body: Record<string, unknown>): Promise<OracleActor>;
  current(actor: OracleActor): Promise<unknown | null>;
  open(actor: OracleActor, briefingId: string): Promise<unknown>;
}

export async function handleAdminBriefing(
  req: Request,
  deps: AdminBriefingDeps,
  cors: Record<string, string>,
): Promise<Response> {
  const json = (status: number, body?: unknown) => new Response(
    body === undefined ? null : JSON.stringify(body),
    { status, headers: body === undefined ? cors : { ...cors, "Content-Type": "application/json" } },
  );
  if (req.method === "OPTIONS") return json(204);
  if (req.method !== "POST") return json(405, { error: "metodo_invalido" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "json_invalido" });
  }

  const actor = await deps.auth(req, body);
  if (!actor.isAdmin) return json(403, { error: "admin_required" });

  if (body.acao === "atual") {
    return json(200, { briefing: await deps.current(actor) });
  }
  if (body.acao === "abrir") {
    const briefingId = typeof body.briefing_id === "string" ? body.briefing_id.trim() : "";
    if (!UUID.test(briefingId)) return json(400, { error: "briefing_invalido" });
    return json(200, await deps.open(actor, briefingId));
  }
  return json(400, { error: "acao_invalida" });
}

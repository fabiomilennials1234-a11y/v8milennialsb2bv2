import type { OracleActor } from "./scope.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BriefingDeps {
  auth(req: Request, body: Record<string, unknown>): Promise<OracleActor>;
  current(actor: OracleActor): Promise<unknown | null>;
  open(actor: OracleActor, briefingId: string): Promise<unknown>;
}

function memberSafeBriefing(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { people: _people, profiles: _profiles, ...safe } = value as Record<string, unknown>;
  const bottleneck = safe.bottleneck;
  if (!bottleneck || typeof bottleneck !== "object" || Array.isArray(bottleneck)) return safe;
  const {
    team_member_id: _teamMemberId,
    team_member_name: _teamMemberName,
    ...anonymous
  } = bottleneck as Record<string, unknown>;
  if (anonymous.dimension !== "person") return { ...safe, bottleneck: anonymous };
  return {
    ...safe,
    bottleneck: { ...anonymous, dimension: "self", key: "self", label: "Seu desempenho" },
  };
}

export async function handleBriefing(
  req: Request,
  deps: BriefingDeps,
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
  if (body.acao === "atual") {
    const briefing = await deps.current(actor);
    return json(200, { briefing: actor.isAdmin ? briefing : memberSafeBriefing(briefing) });
  }
  if (body.acao === "abrir") {
    const briefingId = typeof body.briefing_id === "string" ? body.briefing_id.trim() : "";
    if (!UUID.test(briefingId)) return json(400, { error: "briefing_invalido" });
    return json(200, await deps.open(actor, briefingId));
  }
  return json(400, { error: "acao_invalida" });
}

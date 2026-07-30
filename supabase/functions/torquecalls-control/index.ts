/**
 * torquecalls-control — plano de CONTROLE da chamada de voz (S12).
 *
 * Cuida do ciclo de vida da sessão: listar, criar, parear, deslogar, adotar,
 * apagar. Não disca e não emite credencial de chamada — quem faz isso é
 * `torquecalls-signal`, sobre o choke.
 *
 * Autorização: `resolveCaller` (o mesmo de whatsapp-api-proxy, extraído) +
 * a feature `voip.session.manage`, que nasce `is_admin_only`. Ou seja: só
 * admin, master e gestor de portfólio.
 *
 * A credencial `tc-admin` vive 30 segundos, é cunhada aqui e usada na MESMA
 * requisição, server-to-server. Ela NUNCA vai para o browser — se fosse, o
 * navegador passaria a poder criar sessão de WhatsApp por conta própria.
 *
 * TETO DURÁVEL: o limite de sessões por org é contado no Postgres, não em
 * memória. Limitador em isolate de edge function não existe: cada cold start
 * começa do zero e N isolates concorrentes multiplicam o teto. E aqui o custo é
 * real — cada sessão abre um websocket com o WhatsApp sobre um SQLite com
 * `SetMaxOpenConns(1)`.
 */
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { canUserAccessFeature } from "../_shared/permission_engine.ts";
import { adminClient, type Caller, isOrgAdmin, resolveCaller } from "../_shared/voip/caller.ts";
import { type AdminAction, signAdminToken } from "../_shared/voip/tokens.ts";
import { callVps } from "../_shared/voip/vps.ts";

/** Teto de sessões por organização. Uma por número; mais de duas é sintoma. */
const MAX_SESSIONS_PER_ORG = 2;

type Action =
  | "listSessions"
  | "createSession"
  | "deleteSession"
  | "pairSession"
  | "logoutSession"
  | "adoptSession";

const ACTION_TO_ADMIN_ACT: Record<Action, AdminAction> = {
  listSessions: "session.list",
  createSession: "session.create",
  deleteSession: "session.delete",
  pairSession: "session.pair",
  logoutSession: "session.logout",
  adoptSession: "session.adopt",
};

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withErrorBoundary("torquecalls-control", async (req: Request) => {
    const cors = withSecurityHeaders(
      getCorsHeaders(req.headers.get("Origin") ?? undefined) as Record<string, string>,
    );

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json(405, { error: "Method not allowed" }, cors);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON body" }, cors);
    }

    const action = body.action as Action | undefined;
    if (!action || !(action in ACTION_TO_ADMIN_ACT)) {
      return json(400, { error: "Missing or unknown action" }, cors);
    }

    const supabaseAdmin = adminClient();
    const resolved = await resolveCaller(
      req,
      supabaseAdmin,
      typeof body.organization_id === "string" ? body.organization_id : undefined,
    );
    if (!resolved.ok) return json(resolved.status, { error: resolved.error }, cors);
    const caller = resolved.caller;

    // `voip.session.manage` é admin-only no catálogo, então checkFeaturePermission
    // devolve false para todo membro; a passagem é a cascata de admin.
    if (!isOrgAdmin(caller)) {
      const allowed = await canUserAccessFeature(
        supabaseAdmin,
        caller.userId,
        caller.orgId,
        "voip.session.manage",
      );
      if (!allowed) {
        await logRuntime({
          organizationId: caller.orgId,
          module: "voip",
          action: "session_manage_denied",
          status: "error",
          payloadSnapshot: { user_id: caller.userId, requested: action },
        });
        return json(403, { error: "Sem permissão para gerenciar o número de chamadas" }, cors);
      }
    }

    const sid = typeof body.tc_session_id === "string" ? body.tc_session_id : undefined;
    const needsSid: Action[] = ["deleteSession", "pairSession", "logoutSession", "adoptSession"];
    if (needsSid.includes(action) && !sid) {
      return json(400, { error: "tc_session_id obrigatório" }, cors);
    }

    // Sessão alvo tem que ser da org do chamador. `adoptSession` é a exceção
    // deliberada: adotar é justamente pegar sessão que ainda não tem dono.
    if (sid && action !== "adoptSession") {
      const owned = await sessionBelongsToOrg(supabaseAdmin, sid, caller.orgId);
      if (!owned) return json(404, { error: "Sessão não encontrada" }, cors);
    }

    switch (action) {
      case "listSessions":
        return await listSessions(supabaseAdmin, caller, cors);
      case "createSession":
        return await createSession(supabaseAdmin, caller, body, cors);
      default:
        return await forwardSessionAction(supabaseAdmin, caller, action, sid!, body, cors);
    }
  }),
);

// deno-lint-ignore no-explicit-any
type Admin = any;

async function sessionBelongsToOrg(db: Admin, sid: string, orgId: string): Promise<boolean> {
  const { data } = await db
    .from("voip_sessions")
    .select("tc_session_id")
    .eq("tc_session_id", sid)
    .eq("organization_id", orgId)
    .maybeSingle();
  return !!data;
}

/**
 * A lista vem do CRM, não da VPS. `GET /api/sessions` da VPS devolve as sessões
 * de TODAS as organizações — pedir a ela e filtrar depois seria confiar no
 * filtro do lado errado da fronteira.
 */
async function listSessions(db: Admin, caller: Caller, cors: Record<string, string>) {
  const { data, error } = await db
    .from("voip_sessions")
    .select("tc_session_id, name, jid, status, whatsapp_instance_id, created_at, updated_at")
    .eq("organization_id", caller.orgId)
    .order("created_at", { ascending: true });

  if (error) return json(500, { error: error.message }, cors);
  return json(200, { sessions: data ?? [] }, cors);
}

async function createSession(
  db: Admin,
  caller: Caller,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const instanceId = body.whatsapp_instance_id;
  if (typeof instanceId !== "string") {
    // A instância não é enfeite: é dela que saem `voice_calls_enabled` e
    // `daily_call_cap`, as duas únicas chaves de desligar do desenho (C).
    // Sessão sem instância vinculada não teria como ser governada.
    return json(400, { error: "whatsapp_instance_id obrigatório" }, cors);
  }

  const { data: instance } = await db
    .from("whatsapp_instances")
    .select("id, organization_id")
    .eq("id", instanceId)
    .maybeSingle();

  if (!instance || instance.organization_id !== caller.orgId) {
    await logRuntime({
      organizationId: caller.orgId,
      module: "voip",
      action: "cross_tenant_attempt",
      status: "error",
      payloadSnapshot: {
        caller_org: caller.orgId,
        instance_org: instance?.organization_id ?? null,
        user_id: caller.userId,
        whatsapp_instance_id: instanceId,
      },
    });
    return json(404, { error: "Instância não encontrada" }, cors);
  }

  // Teto durável: conta linha no Postgres. `closed` não ocupa vaga.
  const { count, error: countErr } = await db
    .from("voip_sessions")
    .select("tc_session_id", { count: "exact", head: true })
    .eq("organization_id", caller.orgId)
    .neq("status", "closed");

  if (countErr) return json(500, { error: countErr.message }, cors);
  if ((count ?? 0) >= MAX_SESSIONS_PER_ORG) {
    return json(409, {
      error: `Limite de ${MAX_SESSIONS_PER_ORG} sessões de voz por organização atingido`,
      code: "session_cap_reached",
    }, cors);
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "TorqueCalls";

  const admin = await signAdminToken({ act: "session.create", org: caller.orgId, sub: caller.userId });
  const created = await callVps<{ session?: { id?: string }; id?: string }>(
    "POST",
    "/api/sessions",
    { token: admin.token, body: { name, organization_id: caller.orgId } },
  );

  if (!created.ok) return json(created.status, { error: created.error }, cors);

  const tcSessionId = created.data?.session?.id ?? created.data?.id;
  if (!tcSessionId) {
    return json(502, { error: "VPS criou a sessão mas não devolveu id" }, cors);
  }

  // A linha no CRM é o que torna a sessão governável. Se este INSERT falhar, a
  // sessão existe na VPS e é órfã aqui — por isso ela nasce `pending` e a rota
  // de adoção (S6) existe: o estado intermediário é previsto, não acidente.
  const { error: insertErr } = await db.from("voip_sessions").insert({
    organization_id: caller.orgId,
    whatsapp_instance_id: instanceId,
    tc_session_id: tcSessionId,
    name,
    status: "pending",
    created_by: caller.userId,
  });

  if (insertErr) {
    await logRuntime({
      organizationId: caller.orgId,
      module: "voip",
      action: "session_orphaned_on_vps",
      status: "error",
      errorMessage: insertErr.message,
      payloadSnapshot: { tc_session_id: tcSessionId },
    });
    return json(500, {
      error: "Sessão criada na VPS mas não registrada no CRM",
      code: "session_orphaned",
      tc_session_id: tcSessionId,
    }, cors);
  }

  await logRuntime({
    organizationId: caller.orgId,
    module: "voip",
    action: "session_created",
    status: "success",
    entityType: "voip_session",
    entityId: tcSessionId,
    triggeredBy: caller.userId,
  });

  return json(200, { tc_session_id: tcSessionId, status: "pending" }, cors);
}

const VPS_PATH: Record<string, (sid: string) => { method: "POST" | "DELETE"; path: string }> = {
  deleteSession: (sid) => ({ method: "DELETE", path: `/api/sessions/${encodeURIComponent(sid)}` }),
  pairSession: (sid) => ({ method: "POST", path: `/api/sessions/${encodeURIComponent(sid)}/pair` }),
  logoutSession: (sid) => ({ method: "POST", path: `/api/sessions/${encodeURIComponent(sid)}/logout` }),
  adoptSession: (sid) => ({ method: "POST", path: `/api/sessions/${encodeURIComponent(sid)}/adopt` }),
};

async function forwardSessionAction(
  db: Admin,
  caller: Caller,
  action: Action,
  sid: string,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const admin = await signAdminToken({
    act: ACTION_TO_ADMIN_ACT[action],
    org: caller.orgId,
    sub: caller.userId,
    sid,
  });

  const route = VPS_PATH[action](sid);
  const res = await callVps(route.method, route.path, {
    token: admin.token,
    body: action === "adoptSession" ? { organization_id: caller.orgId } : {},
  });

  if (!res.ok) return json(res.status, { error: res.error }, cors);

  // Espelha o estado no CRM. A VPS é a fonte da conexão; o CRM é a fonte da
  // tenancy — e é ele que o resto do produto lê.
  if (action === "deleteSession") {
    await db.from("voip_sessions").delete().eq("tc_session_id", sid).eq("organization_id", caller.orgId);
  } else if (action === "logoutSession") {
    await db.from("voip_sessions").update({ status: "closed", updated_at: new Date().toISOString() })
      .eq("tc_session_id", sid).eq("organization_id", caller.orgId);
  } else if (action === "pairSession") {
    await db.from("voip_sessions").update({ status: "pairing", updated_at: new Date().toISOString() })
      .eq("tc_session_id", sid).eq("organization_id", caller.orgId);
  } else if (action === "adoptSession") {
    const instanceId = typeof body.whatsapp_instance_id === "string" ? body.whatsapp_instance_id : null;
    if (instanceId) {
      await db.from("voip_sessions").upsert({
        organization_id: caller.orgId,
        whatsapp_instance_id: instanceId,
        tc_session_id: sid,
        status: "pending",
        created_by: caller.userId,
      }, { onConflict: "tc_session_id" });
    }
  }

  await logRuntime({
    organizationId: caller.orgId,
    module: "voip",
    action: `session_${action}`,
    status: "success",
    entityType: "voip_session",
    entityId: sid,
    triggeredBy: caller.userId,
  });

  return json(200, { ok: true, ...(res.data as Record<string, unknown> ?? {}) }, cors);
}

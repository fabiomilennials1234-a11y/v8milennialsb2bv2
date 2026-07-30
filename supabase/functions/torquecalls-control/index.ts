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

/** Padrão quando a organização não tem linha — mesmo default da coluna. */
const DEFAULT_VOICE_SESSIONS_CAP = 10;

export function resolveSessionCap(org: { voice_sessions_cap?: number | null } | null): number {
  const cap = org?.voice_sessions_cap;
  return typeof cap === "number" ? cap : DEFAULT_VOICE_SESSIONS_CAP;
}

/**
 * Chave ausente é chave desligada. O contrário — tratar ausência como
 * liberação — é como uma feature paga vaza para quem não comprou.
 */
export function voiceFeatureOn(features: Record<string, unknown> | null | undefined): boolean {
  return features?.voice_calls === true;
}

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

/**
 * `signAdminToken`/`callVps` tocam credencial Ed25519 e rede real — nenhum dos
 * dois é mockável por cima de um import ESM (binding somente-leitura). Injeção
 * com default é o único jeito de testar o fio do gate/teto/enable-disable sem
 * bater na VPS de verdade; o caminho servido nunca passa `voipDeps` e herda os
 * módulos reais.
 */
interface VoipDeps {
  signAdminToken: typeof signAdminToken;
  callVps: typeof callVps;
  /** Injetado pelo mesmo motivo: escrita real em `runtime_logs`. */
  logRuntime: typeof logRuntime;
}

const defaultVoipDeps: VoipDeps = { signAdminToken, callVps, logRuntime };

/**
 * Gate comercial da voz. Devolve a resposta de recusa, ou `null` quando pode
 * seguir.
 *
 * A feature vem da MESMA fonte que o cliente usa (OrgFeaturesContext chama
 * esta RPC). Ler por `plan_id` seria mais direto e estava errado: o trigger
 * que sincroniza `plan_id` só age quando ele é NULL, e o Master troca plano
 * escrevendo `subscription_plan` (texto). Em produção 7 de 95 organizações
 * têm os dois divergentes — num downgrade, o gate liberaria voz para quem
 * não paga mais. A RPC resolve por `subscription_plan` e não tem esse furo.
 */
async function voiceFeatureDenied(
  db: Admin,
  orgId: string,
  cors: Record<string, string>,
): Promise<Response | null> {
  const { data: fl, error: flErr } = await db.rpc("org_get_features_and_limits", {
    p_org_id: orgId,
  });
  if (flErr) return json(500, { error: flErr.message }, cors);

  const flags = fl as { features?: Record<string, unknown>; plan_name?: string } | null;
  // `plan_name === "master"` é o único ramo que a RPC devolve para master, e
  // master nunca vê lock — mesma convenção do frontend.
  const liberado = flags?.plan_name === "master" || voiceFeatureOn(flags?.features);
  if (liberado) return null;

  // Gate de interface não é gate. A mesma feature que esconde o cartão no
  // catálogo precisa recusar aqui, senão basta chamar a função direto.
  return json(403, {
    error: "Chamada de voz não está no plano desta organização",
    code: "voice_feature_off",
  }, cors);
}

/**
 * Teto durável de sessões por organização. Devolve a resposta de recusa, ou
 * `null` quando há vaga.
 *
 * Conta linha no Postgres, não em memória: limitador em isolate de edge
 * function não existe — cada cold start começa do zero e N isolates
 * concorrentes multiplicam o teto.
 *
 * `exceptSid` existe para a adoção: a sessão que está sendo adotada não pode
 * contar como vaga ocupada contra ela mesma, senão a organização no teto nunca
 * conseguiria reconciliar uma linha que já é dela.
 */
async function sessionCapDenied(
  db: Admin,
  orgId: string,
  cors: Record<string, string>,
  exceptSid?: string,
): Promise<Response | null> {
  // O erro NÃO pode ser descartado. Uma organização com `voice_sessions_cap = 0`
  // — que a migration documenta como "sem direito a número de voz" — viraria
  // teto 10 num SELECT que falhou: o limite mais restritivo virando o mais
  // permissivo, exatamente ao contrário do que um teto existe para fazer.
  const { data: org, error: orgErr } = await db
    .from("organizations")
    .select("voice_sessions_cap")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) return json(500, { error: orgErr.message }, cors);

  // `closed` não ocupa vaga.
  let query = db
    .from("voip_sessions")
    .select("tc_session_id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .neq("status", "closed");
  if (exceptSid) query = query.neq("tc_session_id", exceptSid);

  const { count, error: countErr } = await query;
  if (countErr) return json(500, { error: countErr.message }, cors);

  const cap = resolveSessionCap(org as { voice_sessions_cap?: number | null } | null);
  if ((count ?? 0) >= cap) {
    return json(409, {
      error: `Limite de ${cap} números de voz por organização atingido`,
      code: "session_cap_reached",
    }, cors);
  }
  return null;
}

/**
 * Liga ou desliga a chave do cliente, e RECLAMA quando não consegue.
 *
 * Sem checar o erro, uma falha aqui deixava o cliente vendo sucesso e o número
 * num estado que ninguém consegue explicar depois — habilitado sem sessão, ou
 * pareado sem habilitação — e sem uma linha de log para reconstruir o que
 * aconteceu.
 *
 * A falha NÃO derruba a resposta de propósito: no desligamento a VPS já
 * encerrou, e devolver erro faria o cliente repetir uma ação já concluída lá;
 * na criação a sessão já existe, e falhar aqui a deixaria órfã. Em ambos os
 * casos a segunda tranca (`voip_sessions.status = 'open'`) continua valendo, e
 * o rastro é o que permite consertar depois.
 */
async function setVoiceCallsEnabled(
  db: Admin,
  deps: VoipDeps,
  args: { instanceId: string; orgId: string; enabled: boolean; userId: string; sid?: string },
): Promise<void> {
  const { error } = await db
    .from("whatsapp_instances")
    .update({ voice_calls_enabled: args.enabled })
    .eq("id", args.instanceId)
    .eq("organization_id", args.orgId);

  if (!error) return;

  await deps.logRuntime({
    organizationId: args.orgId,
    module: "voip",
    action: args.enabled ? "voice_calls_enable_failed" : "voice_calls_disable_failed",
    status: "error",
    errorMessage: error.message,
    entityType: "whatsapp_instance",
    entityId: args.instanceId,
    triggeredBy: args.userId,
    payloadSnapshot: { tc_session_id: args.sid ?? null },
  });
}

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

export async function createSession(
  db: Admin,
  caller: Caller,
  body: Record<string, unknown>,
  cors: Record<string, string>,
  deps: VoipDeps = defaultVoipDeps,
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
    await deps.logRuntime({
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

  const semFeature = await voiceFeatureDenied(db, caller.orgId, cors);
  if (semFeature) return semFeature;

  const semVaga = await sessionCapDenied(db, caller.orgId, cors);
  if (semVaga) return semVaga;

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "TorqueCalls";

  const admin = await deps.signAdminToken({ act: "session.create", org: caller.orgId, sub: caller.userId });
  const created = await deps.callVps<{ session?: { id?: string }; id?: string }>(
    "POST",
    "/api/sessions",
    { token: admin.token, body: { name, organization_id: caller.orgId } },
  );

  // Repassa o `code` da VPS quando ela mandar um — sem isto uma recusa
  // codificada (ex.: limite de aparelhos do WhatsApp) chegaria ao cliente só
  // como texto cru, e a tabela de tradução do cliente nunca teria como
  // disparar por falta do código para procurar nela.
  if (!created.ok) {
    return json(
      created.status,
      { error: created.error, ...(created.code ? { code: created.code } : {}) },
      cors,
    );
  }

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
    await deps.logRuntime({
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

  // Sem isto o cliente pareia com sucesso e toda ligação continua recusada
  // com `voice_calls_disabled`, na raiz de fn_voip_call_reserve. Era o elo
  // que faltava para a voz sair do estado "construída e nunca ligada".
  //
  // PROVISÓRIO, e deliberadamente fora do lugar: a spec pede que a chave do
  // cliente acompanhe o PAREAMENTO, não a criação da sessão. Não existe evento
  // de pareamento no servidor — o webhook que o traria é o S11, que não existe
  // neste repositório —, então ligar aqui é a única opção que não deixa a
  // chave desligada para sempre. Ligada cedo demais ela é inofensiva: a
  // segunda tranca (`voip_sessions.status = 'open'`) ainda recusa a ligação
  // com `session_not_open`. Quando o S11 chegar, mova para lá.
  await setVoiceCallsEnabled(db, deps, {
    instanceId,
    orgId: caller.orgId,
    enabled: true,
    userId: caller.userId,
    sid: tcSessionId,
  });

  await deps.logRuntime({
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

export async function forwardSessionAction(
  db: Admin,
  caller: Caller,
  action: Action,
  sid: string,
  body: Record<string, unknown>,
  cors: Record<string, string>,
  deps: VoipDeps = defaultVoipDeps,
) {
  // ─── Gate comercial, com assimetria deliberada ─────────────────────────────
  //
  // `pairSession` e `adoptSession` CRIAM ou REATIVAM capacidade de voz — são
  // porta de entrada tanto quanto `createSession`, e sem gate aqui bastava
  // chamar a função direto para contornar o kill-switch inteiro.
  //
  // `logoutSession` e `deleteSession` ficam DE FORA de propósito. O gate é
  // justamente a chave que a gente derruba, e derrubá-la some com o cartão do
  // catálogo: barrar o desligamento junto trancaria o cliente com um número
  // ligado, uma vaga ocupada no teto e nenhuma saída pela tela. Quem já está
  // ligado tem que continuar podendo desligar.
  if (action === "pairSession" || action === "adoptSession") {
    const semFeature = await voiceFeatureDenied(db, caller.orgId, cors);
    if (semFeature) return semFeature;
  }

  // Adotar cria linha nova em `voip_sessions` (upsert) e escapava do teto
  // inteiro — era o caminho por onde D3 vazava. `sid` sai da contagem porque
  // adotar uma sessão que já tem linha não pode contar ela mesma como vaga.
  if (action === "adoptSession") {
    const semVaga = await sessionCapDenied(db, caller.orgId, cors, sid);
    if (semVaga) return semVaga;
  }

  const admin = await deps.signAdminToken({
    act: ACTION_TO_ADMIN_ACT[action],
    org: caller.orgId,
    sub: caller.userId,
    sid,
  });

  const route = VPS_PATH[action](sid);
  const res = await deps.callVps(route.method, route.path, {
    token: admin.token,
    body: action === "adoptSession" ? { organization_id: caller.orgId } : {},
  });

  // Mesmo repasse de `code` de `createSession`: pairSession/logoutSession/
  // deleteSession/adoptSession passam pela mesma VPS e pelo mesmo VpsResult.
  if (!res.ok) {
    return json(res.status, { error: res.error, ...(res.code ? { code: res.code } : {}) }, cors);
  }

  // Desliga o número antes de a linha de voip_sessions sumir (deleteSession)
  // ou virar closed (logoutSession) — depois disso o vínculo com a instância
  // não é mais consultável aqui.
  if (action === "logoutSession" || action === "deleteSession") {
    const { data: sess } = await db
      .from("voip_sessions")
      .select("whatsapp_instance_id")
      .eq("tc_session_id", sid)
      .eq("organization_id", caller.orgId)
      .maybeSingle();
    if (sess?.whatsapp_instance_id) {
      await setVoiceCallsEnabled(db, deps, {
        instanceId: sess.whatsapp_instance_id,
        orgId: caller.orgId,
        enabled: false,
        userId: caller.userId,
        sid,
      });
    }
  }

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

  await deps.logRuntime({
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

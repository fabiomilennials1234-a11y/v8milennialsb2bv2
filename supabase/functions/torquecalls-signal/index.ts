/**
 * torquecalls-signal — plano de SINALIZAÇÃO da chamada de voz (S12).
 *
 * É o único caller de `authorizeCallAndMint`. Essa lista é fechada e verificável:
 * `scripts/test-voip-choke.sh` reprova o build se aparecer um segundo.
 *
 * Ações:
 *   streamToken  — credencial de 60s para o browser abrir o SSE de eventos
 *   startCall    — discar para um lead (passa pelo choke)
 *   acceptCall   — atender chamada de entrada (passa pelo choke)
 *   rejectCall   — recusar chamada de entrada
 *   endCall      — encerrar chamada em curso
 *   renewCtl     — renovar só a credencial de encerrar
 *
 * O corpo da requisição NÃO carrega organização, operador nem telefone. Os dois
 * primeiros vêm do `Caller` opaco; o terceiro é derivado do lead pelo choke.
 * Um `lead_id` legítimo com um número arbitrário no corpo era o último caminho
 * de ataque que sobrevivia ao desenho.
 */
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { canUserAccessFeature } from "../_shared/permission_engine.ts";
import { adminClient, type Caller, isOrgAdmin, resolveCaller } from "../_shared/voip/caller.ts";
import { authorizeCallAndMint, renewCallControlToken } from "../_shared/voip/call-plane.ts";
import { signStreamToken, STREAM_TTL_SECONDS } from "../_shared/voip/tokens.ts";
import { callVps, publicVpsUrl } from "../_shared/voip/vps.ts";
import {
  refusedCallPatch,
  type VpsRefusalCode,
  vpsRefusalCode,
} from "../_shared/voip/vps-refusal.ts";

type Action =
  | "streamToken"
  | "startCall"
  | "acceptCall"
  | "rejectCall"
  | "endCall"
  | "renewCtl";

function json(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

Deno.serve(
  withErrorBoundary("torquecalls-signal", async (req: Request) => {
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
    const supabaseAdmin = adminClient();

    const resolved = await resolveCaller(
      req,
      supabaseAdmin,
      typeof body.organization_id === "string" ? body.organization_id : undefined,
    );
    if (!resolved.ok) return json(resolved.status, { error: resolved.error }, cors);
    const caller = resolved.caller;

    const sid = typeof body.tc_session_id === "string" ? body.tc_session_id : "";
    if (!sid) return json(400, { error: "tc_session_id obrigatório" }, cors);

    switch (action) {
      case "streamToken":
        return await streamToken(supabaseAdmin, caller, sid, body, cors);
      case "startCall":
        return await startCall(supabaseAdmin, caller, sid, body, cors);
      case "acceptCall":
        return await acceptCall(supabaseAdmin, caller, sid, body, cors);
      case "rejectCall":
      case "endCall":
        return await terminate(supabaseAdmin, caller, sid, action, body, cors);
      case "renewCtl":
        return await renewCtl(supabaseAdmin, caller, sid, body, cors);
      default:
        return json(400, { error: "Missing or unknown action" }, cors);
    }
  }),
);

// deno-lint-ignore no-explicit-any
type Admin = any;

/** A sessão pertence à org do chamador? Validado no momento da emissão, sempre. */
async function ownedSession(db: Admin, sid: string, orgId: string) {
  const { data } = await db
    .from("voip_sessions")
    .select("tc_session_id, status")
    .eq("tc_session_id", sid)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data as { tc_session_id: string; status: string } | null;
}

/**
 * Credencial do stream de eventos.
 *
 * O `sid` pedido é conferido contra `voip_sessions` AQUI, no instante da
 * emissão — não na VPS. Sem isso, pedir o histórico de uma sessão de outra
 * organização seria só saber o id dela.
 *
 * `vis` é decidido pelo CRM porque a VPS não tem como avaliar
 * `can_see_lead_by_permissions`: ela recebe o veredito, não a regra.
 */
async function streamToken(
  db: Admin,
  caller: Caller,
  sid: string,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  if (!await ownedSession(db, sid, caller.orgId)) {
    return json(404, { error: "Sessão não encontrada" }, cors);
  }

  const canSeeAll = isOrgAdmin(caller) ||
    await canUserAccessFeature(db, caller.userId, caller.orgId, "leads.view_all");

  // O QR de pareamento é CREDENCIAL: quem o lê pareia o WhatsApp da organização.
  // Só sai para quem pode gerenciar sessão.
  let pairSid: string | undefined;
  if (body.pair === true) {
    const canManage = isOrgAdmin(caller) ||
      await canUserAccessFeature(db, caller.userId, caller.orgId, "voip.session.manage");
    if (!canManage) return json(403, { error: "Sem permissão para parear" }, cors);
    pairSid = sid;
  }

  const stream = await signStreamToken({
    org: caller.orgId,
    sub: caller.userId,
    sid,
    vis: canSeeAll ? "org" : "own",
    pairSid,
  });

  return json(200, {
    token: stream.token,
    expires_at: stream.expiresAt,
    // O cliente renova antes de expirar: o TTL curto É a revogação, e por isso
    // não existe denylist em nenhuma fatia deste desenho.
    renew_in_ms: Math.floor(STREAM_TTL_SECONDS * 0.75) * 1000,
    vps_url: publicVpsUrl(),
  }, cors);
}

async function startCall(
  db: Admin,
  caller: Caller,
  sid: string,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const leadId = typeof body.lead_id === "string" ? body.lead_id : null;

  const authorized = await authorizeCallAndMint(caller, {
    supabaseAdmin: db,
    tcSessionId: sid,
    direction: "outbound",
    leadId,
  });

  if (!authorized.ok) return denied(caller, authorized, cors);

  // A VPS resolve o JID via IsOnWhatsApp a partir dos dígitos. Quem escolheu os
  // dígitos foi o choke, lendo o lead — não quem chamou esta função.
  const started = await callVps<{ call?: { callId?: string } }>(
    "POST",
    `/api/sessions/${encodeURIComponent(sid)}/calls`,
    { token: authorized.tokens.start, body: { phone: authorized.peer } },
  );

  if (!started.ok) {
    // A causa vira um CÓDIGO aqui, uma vez. Antes, toda recusa desta rota saía
    // como `vps_refused` e o front traduzia em "o serviço de chamadas recusou a
    // ligação" — frase com a qual o vendedor não pode fazer nada, para uma causa
    // que ele resolveria em dez segundos (issue #1365).
    const code = vpsRefusalCode(started);
    await releaseReservation(db, authorized.callId, code, started.error);
    return json(started.status, { error: started.error, code }, cors);
  }

  // A VPS ecoa o id que autorizamos. Divergência aqui é defeito de contrato, não
  // dado a absorver: escrever o valor dela por cima faria o ledger e a
  // credencial falarem de chamadas diferentes, que é exatamente o desencontro
  // que esta fatia consertou.
  const ecoado = started.data?.call?.callId ?? null;
  if (ecoado && ecoado !== authorized.tcCallId) {
    await logRuntime({
      organizationId: caller.orgId,
      module: "voip",
      action: "vps_call_id_divergente",
      status: "error",
      entityType: "voip_call",
      entityId: authorized.callId,
      payloadSnapshot: { autorizado: authorized.tcCallId, ecoado },
    });
  }

  await db
    .from("voip_calls")
    .update({
      status: "ringing",
      ringing_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", authorized.callId);

  return json(200, {
    call_id: authorized.callId,
    tc_call_id: authorized.tcCallId,
    peer: authorized.peer,
    media: authorized.tokens.media,
    ctl: authorized.tokens.ctl,
    vps_url: publicVpsUrl(),
  }, cors);
}

/**
 * A linha do ledger que o operador quer atender, a partir do que o NAVEGADOR
 * sabe.
 *
 * O cartão da chamada recebida nasce do stream da VPS, e o stream carrega o id
 * de REDE (`tc_call_id`) — nunca o uuid de `voip_calls`, que só existe do lado
 * de cá e que a VPS nem conhece. Exigir `call_id` obrigaria o navegador a ler
 * `voip_calls` só para traduzir um id no outro, o que custaria uma consulta e,
 * pior, faria o atendimento depender do formato da RLS daquela tabela: hoje
 * `voip_can_see_call(NULL)` devolve `true` e a linha sem lead é legível, mas
 * essa é uma decisão de OUTRA regra, livre para mudar sem saber que o botão de
 * atender depende dela.
 *
 * `call_id` continua aceito e vem PRIMEIRO: quem já tem o uuid não precisa de
 * tradução, e é o caminho que os testes de choke já exercem.
 *
 * ─── A identidade é o PAR `(sessão, id de rede)` ─────────────────────────────
 * Na entrada o `tc_call_id` vem do stanza REMOTO — string escolhida pelo outro
 * lado — e nada garante que dois números da mesma organização não recebam o
 * mesmo valor. O broker da VPS chaveia por `callKey{sessionID, callID}`
 * exatamente por isso, e `useIncomingVoiceCalls` repete a chave no navegador.
 * Buscar só pelo id aqui reintroduziria, no servidor, a premissa que os dois
 * outros lados já descartaram: um peer remoto escolhendo o id certo faria o
 * operador atender a chamada de outro número da organização.
 *
 * O filtro por status é a mesma pergunta que `authorizeCallAndMint` faz adiante
 * (e `fn_voip_call_reserve` amarra no WHERE do UPDATE, que é o gate real). Aqui
 * ele existe para que uma chamada JÁ ENCERRADA com o mesmo id não seja a linha
 * escolhida, e a autorização acabe negando a errada.
 */
async function resolveInboundCall(
  db: Admin,
  caller: Caller,
  sid: string,
  body: Record<string, unknown>,
): Promise<
  { ok: true; callId: string; tcCallId: string } | { ok: false; status: number; code: string }
> {
  const callId = typeof body.call_id === "string" ? body.call_id : null;
  if (callId) {
    const { data } = await db
      .from("voip_calls")
      .select("id, tc_call_id, organization_id")
      .eq("id", callId)
      .maybeSingle();
    // Org conferida aqui também: sem isto o `no_tc_call_id` de uma linha de
    // outra organização já contaria que ela existe. A negativa de autorização
    // que viria adiante (`session_org_mismatch`) chegaria tarde demais.
    if (!data || data.organization_id !== caller.orgId) {
      return { ok: false, status: 409, code: "call_not_answerable" };
    }
    if (!data.tc_call_id) return { ok: false, status: 409, code: "no_tc_call_id" };
    return { ok: true, callId, tcCallId: data.tc_call_id };
  }

  const tcCallId = typeof body.tc_call_id === "string" ? body.tc_call_id : null;
  if (!tcCallId) return { ok: false, status: 400, code: "call_id_required" };

  const { data } = await db
    .from("voip_calls")
    .select("id, tc_call_id")
    .eq("organization_id", caller.orgId)
    .eq("tc_session_id", sid)
    .eq("tc_call_id", tcCallId)
    .in("status", ["ringing", "authorized"])
    // Duas linhas com o mesmo par não deveriam existir; se existirem, a mais
    // nova é a que está tocando agora.
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { ok: false, status: 409, code: "call_not_answerable" };
  return { ok: true, callId: data.id, tcCallId };
}

async function acceptCall(
  db: Admin,
  caller: Caller,
  sid: string,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const alvo = await resolveInboundCall(db, caller, sid, body);
  if (!alvo.ok) {
    return json(
      alvo.status,
      {
        error: alvo.code === "call_id_required" ? "call_id ou tc_call_id obrigatório" : alvo.code,
        code: alvo.code,
      },
      cors,
    );
  }
  const { callId, tcCallId } = alvo;

  const authorized = await authorizeCallAndMint(caller, {
    supabaseAdmin: db,
    tcSessionId: sid,
    direction: "inbound",
    existingCallId: callId,
  });

  if (!authorized.ok) return denied(caller, authorized, cors);

  const accepted = await callVps(
    "POST",
    `/api/sessions/${encodeURIComponent(sid)}/calls/${encodeURIComponent(tcCallId)}/accept`,
    { token: authorized.tokens.start, body: {} },
  );

  // Mesma tradução do outbound. Atender tem motivos próprios ("no such call",
  // "claimed by another client") que hoje ainda caem no balde genérico — o mapa
  // é o lugar de acrescentá-los quando merecerem frase própria. O que não pode
  // é esta rota ter uma tradução diferente da outra para a MESMA causa.
  if (!accepted.ok) {
    return json(accepted.status, { error: accepted.error, code: vpsRefusalCode(accepted) }, cors);
  }

  return json(200, {
    call_id: authorized.callId,
    tc_call_id: tcCallId,
    peer: authorized.peer,
    media: authorized.tokens.media,
    ctl: authorized.tokens.ctl,
    vps_url: publicVpsUrl(),
  }, cors);
}

/**
 * Encerrar e recusar NÃO passam pelo choke: quem já está na chamada tem o `ctl`,
 * emitido no momento da autorização e válido por 30 minutos justamente para que
 * desligar não dependa da rede do CRM. Aqui é o caminho de reserva, para quando
 * o cliente perdeu o token — e por isso exige ser o operador da chamada.
 */
async function terminate(
  db: Admin,
  caller: Caller,
  sid: string,
  action: "endCall" | "rejectCall",
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const callId = typeof body.call_id === "string" ? body.call_id : null;
  if (!callId) return json(400, { error: "call_id obrigatório" }, cors);

  const { data: call } = await db
    .from("voip_calls")
    .select("id, organization_id, tc_call_id, operator_user_id, status")
    .eq("id", callId)
    .maybeSingle();

  if (!call || call.organization_id !== caller.orgId) {
    // `code` legível por máquina: sem ele o cliente não conseguia distinguir
    // "já acabou" de "deu ruim" e ficava preso em "Encerrando…". Continua 404
    // e continua sem revelar se a chamada existe em outra organização.
    return json(404, { error: "Chamada não encontrada", code: "call_not_found" }, cors);
  }
  if (!isOrgAdmin(caller) && call.operator_user_id && call.operator_user_id !== caller.userId) {
    return json(403, { error: "Chamada de outro operador", code: "not_operator" }, cors);
  }
  if (!call.tc_call_id) {
    return json(409, { error: "Chamada sem id de rede", code: "no_tc_call_id" }, cors);
  }

  const path = action === "endCall"
    ? `/api/sessions/${encodeURIComponent(sid)}/calls/${encodeURIComponent(call.tc_call_id)}`
    : `/api/sessions/${encodeURIComponent(sid)}/calls/${encodeURIComponent(call.tc_call_id)}/reject`;

  const ctl = await renewCallControlToken(caller, {
    supabaseAdmin: db,
    tcSessionId: sid,
    callId: call.id,
  });
  if (!ctl.ok) return json(409, { error: ctl.code, code: ctl.code }, cors);

  const res = await callVps(action === "endCall" ? "DELETE" : "POST", path, {
    token: ctl.ctl,
    body: action === "endCall" ? undefined : {},
  });

  // 404 da VPS é "essa chamada não existe mais lá" — que é o desfecho pedido,
  // não uma falha. Acontece toda vez que o outro lado desliga primeiro: a VPS
  // purga a chamada e o DELETE chega tarde.
  //
  // Devolver erro aqui era o que deixava a linha PRESA. A escrita abaixo é a
  // única coisa que fecha `voip_calls` enquanto o webhook de fim de chamada
  // (S11) não existe, e ela ficava do lado errado do early return: a linha
  // seguia aberta segurando a cota, e a tentativa seguinte do mesmo operador
  // voltava `operator_busy` até o reaper passar.
  if (!res.ok && res.status !== 404) {
    return json(res.status, { error: res.error }, cors);
  }

  // O estado final autoritativo vem pelo webhook (S11). Aqui só antecipamos o
  // que o operador acabou de mandar, para a tela não ficar mentindo.
  await db.from("voip_calls").update({
    status: "ended",
    end_reason: action === "endCall" ? "user_ended" : "rejected",
    ended_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", callId).neq("status", "ended");

  return json(200, { ok: true, already_ended: !res.ok }, cors);
}

async function renewCtl(
  db: Admin,
  caller: Caller,
  sid: string,
  body: Record<string, unknown>,
  cors: Record<string, string>,
) {
  const callId = typeof body.call_id === "string" ? body.call_id : null;
  if (!callId) return json(400, { error: "call_id obrigatório" }, cors);

  const renewed = await renewCallControlToken(caller, {
    supabaseAdmin: db,
    tcSessionId: sid,
    callId,
  });

  if (!renewed.ok) {
    const status = renewed.code === "call_not_found" ? 404 : renewed.code === "not_operator" ? 403 : 409;
    return json(status, { error: renewed.code, code: renewed.code }, cors);
  }

  return json(200, { ctl: renewed.ctl, expires_at: renewed.expiresAt }, cors);
}

/**
 * A VPS recusou: a reserva não pode ficar segurando cota até o reaper passar.
 *
 * O QUE é escrito — estado e motivo — mora em `refusedCallPatch`, que é pura e
 * tem teste. Aqui fica só o ONDE: a linha certa, e apenas enquanto ela ainda
 * está `authorized` (o `.eq` final é o que impede sobrescrever uma chamada que
 * já andou por outro caminho).
 */
async function releaseReservation(
  db: Admin,
  callId: string,
  code: VpsRefusalCode,
  reason: string,
) {
  await db
    .from("voip_calls")
    .update(refusedCallPatch(code, reason, new Date().toISOString()))
    .eq("id", callId)
    .eq("status", "authorized");
}

function denied(
  caller: Caller,
  result: { ok: false; code: string; retryAfterMs?: number },
  cors: Record<string, string>,
): Response {
  // `not_instance_member` e `lead_not_visible` são recusas de AUTORIZAÇÃO —
  // o operador não opera por aquele número, ou não enxerga aquele lead — e
  // saem 403 junto de `permission_denied`. Sem isto caíam no 409 genérico, no
  // mesmo balde de `operator_busy`/`rate_limited`, que são "tente de novo": a
  // interface leria "espere" onde o certo é "não é seu".
  const status = result.code === "permission_denied" || result.code === "lead_not_visible" ||
      result.code === "not_instance_member"
    ? 403
    : result.code === "consent_missing"
    ? 412
    : result.code === "session_not_found" || result.code === "lead_not_found"
    ? 404
    : 409;

  logRuntime({
    organizationId: caller.orgId,
    module: "voip",
    action: "call_denied",
    status: "error",
    payloadSnapshot: { code: result.code, user_id: caller.userId },
  });

  return json(status, { error: result.code, code: result.code, retry_after_ms: result.retryAfterMs }, cors);
}

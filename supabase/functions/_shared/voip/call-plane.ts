/**
 * O choke do TorqueCalls.
 *
 * `authorizeCallAndMint` é a única função do repositório que produz credencial
 * de escopo `call`, e ela roda o governor antes de assinar. Como a VPS recusa
 * requisição sem essa credencial, passar pelo governor e obter autoridade são
 * literalmente a mesma operação — não há endpoint a instrumentar nem caller a
 * lembrar de enumerar.
 *
 * Callers diretos hoje: `torquecalls-signal` (startCall, acceptCall). Qualquer
 * caller futuro — nó de discagem no workflow, copilot ligando, campanha —
 * importa daqui. Não existe outra porta.
 *
 * Duas coisas que o corpo da requisição NÃO carrega, de propósito:
 *   - organização e operador, que vêm do `Caller` opaco;
 *   - o número de destino, derivado do lead no servidor. Era o único dado do
 *     atacante que sobrevivia ao desenho inteiro: com o telefone no corpo,
 *     "lead legítimo + número arbitrário" discaria para qualquer lugar e ainda
 *     driblaria o teto por destino.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canUserAccessFeature } from "../permission_engine.ts";
import { logRuntime } from "../logger.ts";
import { type Caller, isOrgAdmin } from "./caller.ts";
import { signCallToken } from "./internal/sign.ts";

/** Validade de cada credencial. Três tokens, não um com três ações. */
const TTL_START_SECONDS = 15;
const TTL_MEDIA_SECONDS = 90;
/**
 * `ctl` é longo porque encerrar chamada NÃO pode depender da rede do CRM no
 * momento do clique: chamada pendurada custa dinheiro e é vetor de ban. O preço
 * aceito é que um membro desligado consegue encerrar chamadas em curso por até
 * 30 minutos — o que ele já poderia fazer desligando o navegador.
 */
const TTL_CTL_SECONDS = 30 * 60;

export type CallDirection = "outbound" | "inbound";

export type DenyCode =
  | "session_not_found"
  | "session_org_mismatch"
  | "session_not_open"
  | "instance_not_found"
  | "voice_calls_disabled"
  | "lead_required"
  | "lead_not_found"
  | "lead_org_mismatch"
  | "lead_without_phone"
  | "not_lead_owner"
  | "permission_denied"
  | "consent_missing"
  | "call_not_answerable"
  | "invalid_peer"
  | "invalid_direction"
  | "daily_cap_reached"
  | "org_concurrency_reached"
  | "rate_limited"
  | "peer_daily_cap_reached"
  | "peer_backoff"
  | "operator_busy"
  | "reserve_failed";

export interface AuthorizeArgs {
  supabaseAdmin: SupabaseClient;
  tcSessionId: string;
  direction: CallDirection;
  /** Obrigatório no outbound. No inbound vem da linha que o webhook criou. */
  leadId?: string | null;
  /** Chamada de entrada sendo atendida (voip_calls.id criado no ringing). */
  existingCallId?: string | null;
}

export type AuthorizeResult =
  | {
    ok: true;
    callId: string;
    peer: string;
    leadId: string | null;
    tokens: { start: string; media: string; ctl: string };
    expiresAt: { start: number; media: number; ctl: number };
  }
  | { ok: false; code: DenyCode; retryAfterMs?: number };

function deny(code: DenyCode, retryAfterMs?: number): AuthorizeResult {
  return retryAfterMs === undefined
    ? { ok: false, code }
    : { ok: false, code, retryAfterMs };
}

/** Dígitos, sem máscara. O teto por destino conta sobre isto. */
function digitsOnly(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

export type RenewCtlResult =
  | { ok: true; ctl: string; expiresAt: number }
  | { ok: false; code: "call_not_found" | "call_ended" | "not_operator" };

/**
 * Renova SÓ a credencial de encerrar, para uma chamada que já existe.
 *
 * Não passa pelo governor de propósito: a chamada já foi autorizada e já ocupa
 * cota. Fazer a renovação disputar o teto derrubaria uma chamada em curso por
 * causa de um limite que ela mesma preenche.
 *
 * Mora aqui, e não na edge function, porque assinar escopo `call` é privilégio
 * deste arquivo — é o que `scripts/test-voip-choke.sh` verifica. O poder é
 * estreito por construção: emite apenas `call.end`, para uma chamada viva, do
 * operador que a atende (ou de um admin da org).
 */
export async function renewCallControlToken(
  caller: Caller,
  args: { supabaseAdmin: SupabaseClient; tcSessionId: string; callId: string },
): Promise<RenewCtlResult> {
  const { data: call } = await args.supabaseAdmin
    .from("voip_calls")
    .select("id, organization_id, tc_session_id, peer_phone, lead_id, operator_user_id, status")
    .eq("id", args.callId)
    .maybeSingle();

  if (!call || call.organization_id !== caller.orgId || call.tc_session_id !== args.tcSessionId) {
    return { ok: false, code: "call_not_found" };
  }
  if (call.status === "ended" || call.status === "expired") {
    return { ok: false, code: "call_ended" };
  }
  if (!isOrgAdmin(caller) && call.operator_user_id && call.operator_user_id !== caller.userId) {
    return { ok: false, code: "not_operator" };
  }

  const t = await signCallToken({
    act: ["call.end"],
    ttlSeconds: TTL_CTL_SECONDS,
    org: caller.orgId,
    sub: caller.userId,
    sid: args.tcSessionId,
    cid: call.id,
    peer: call.peer_phone,
    lead: call.lead_id,
  });

  return { ok: true, ctl: t.token, expiresAt: t.expiresAt };
}

export async function authorizeCallAndMint(
  caller: Caller,
  args: AuthorizeArgs,
): Promise<AuthorizeResult> {
  const { supabaseAdmin, tcSessionId, direction } = args;

  if (direction !== "outbound" && direction !== "inbound") {
    return deny("invalid_direction");
  }

  // 1. A sessão pertence à org do chamador. Sem isto, um operador da org A
  //    discaria pelo número da org B só sabendo o id da sessão.
  const { data: session } = await supabaseAdmin
    .from("voip_sessions")
    .select("tc_session_id, organization_id, status")
    .eq("tc_session_id", tcSessionId)
    .maybeSingle();

  if (!session) return deny("session_not_found");
  if (session.organization_id !== caller.orgId) {
    await logRuntime({
      organizationId: caller.orgId,
      module: "voip",
      action: "cross_tenant_attempt",
      status: "error",
      payloadSnapshot: {
        caller_org: caller.orgId,
        session_org: session.organization_id,
        user_id: caller.userId,
        tc_session_id: tcSessionId,
      },
    });
    return deny("session_org_mismatch");
  }
  if (session.status !== "open") return deny("session_not_open");

  // 2. Destino e lead — derivados no servidor, nunca recebidos.
  let leadId: string | null = args.leadId ?? null;
  let peer: string;

  if (direction === "outbound") {
    if (!leadId) return deny("lead_required");

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, organization_id, normalized_phone, phone_digits, phone, sdr_id, closer_id, responsible_id")
      .eq("id", leadId)
      .maybeSingle();

    if (!lead) return deny("lead_not_found");
    if (lead.organization_id !== caller.orgId) return deny("lead_org_mismatch");

    peer = digitsOnly(lead.normalized_phone) ||
      digitsOnly(lead.phone_digits) ||
      digitsOnly(lead.phone);
    if (peer.length < 8 || peer.length > 15) return deny("lead_without_phone");

    // Admin operacional alcança qualquer lead da org; membro só os seus. É a
    // mesma fronteira que a RLS de voip_calls aplica na leitura — se a escrita
    // fosse mais larga, o operador ligaria para um lead que depois não conseguiria ver.
    if (!isOrgAdmin(caller)) {
      const owns = caller.teamMemberId !== null &&
        (lead.sdr_id === caller.teamMemberId ||
          lead.closer_id === caller.teamMemberId ||
          lead.responsible_id === caller.teamMemberId);
      if (!owns) return deny("not_lead_owner");
    }
  } else {
    if (!args.existingCallId) return deny("call_not_answerable");

    const { data: call } = await supabaseAdmin
      .from("voip_calls")
      .select("id, organization_id, peer_phone, lead_id, status")
      .eq("id", args.existingCallId)
      .maybeSingle();

    if (!call) return deny("call_not_answerable");
    if (call.organization_id !== caller.orgId) return deny("session_org_mismatch");
    if (call.status !== "ringing" && call.status !== "authorized") {
      return deny("call_not_answerable");
    }

    peer = digitsOnly(call.peer_phone);
    leadId = call.lead_id ?? null;
    if (peer.length < 8 || peer.length > 15) return deny("invalid_peer");
  }

  // 3. Permissão granular. Admin/master/gestor passam pela cascata do engine.
  const featureKey = direction === "outbound" ? "voip.call.start" : "voip.call.answer";
  if (!isOrgAdmin(caller)) {
    const allowed = await canUserAccessFeature(
      supabaseAdmin,
      caller.userId,
      caller.orgId,
      featureKey,
    );
    if (!allowed) return deny("permission_denied");
  }

  // 4. Consentimento de voz — só no outbound. Quem ligou para nós já consentiu
  //    no ato. `source` restrito porque 'manual' é o vendedor afirmando o
  //    consentimento do lead, o que não é consentimento.
  let consentRecordId: string | null = null;
  if (direction === "outbound") {
    const { data: consent } = await supabaseAdmin
      .from("consent_records")
      .select("id")
      .eq("organization_id", caller.orgId)
      .eq("lead_id", leadId)
      .eq("consent_type", "voice_call_whatsapp")
      .eq("granted", true)
      .is("revoked_at", null)
      .in("source", ["form", "api", "webhook"])
      .limit(1)
      .maybeSingle();

    if (!consent) return deny("consent_missing");
    consentRecordId = consent.id;
  }

  // 5. Reserva atômica: kill-switch da instância, teto diário, concorrência da
  //    org, taxa por minuto, teto por destino e backoff — uma transação.
  const { data: reserved, error: reserveErr } = await supabaseAdmin.rpc(
    "fn_voip_call_reserve",
    {
      p_organization_id: caller.orgId,
      p_operator_user_id: caller.userId,
      p_tc_session_id: tcSessionId,
      p_peer_phone: peer,
      p_lead_id: leadId,
      p_direction: direction,
      p_consent_record_id: consentRecordId,
      p_existing_call_id: args.existingCallId ?? null,
    },
  );

  if (reserveErr || !reserved) {
    await logRuntime({
      organizationId: caller.orgId,
      module: "voip",
      action: "reserve_failed",
      status: "error",
      errorMessage: reserveErr?.message ?? "rpc devolveu vazio",
      payloadSnapshot: { tc_session_id: tcSessionId, direction },
    });
    return deny("reserve_failed");
  }

  const result = reserved as { ok: boolean; code?: string; call_id?: string; retry_after_ms?: number };
  if (!result.ok) {
    return deny((result.code ?? "reserve_failed") as DenyCode, result.retry_after_ms);
  }

  const callId = result.call_id!;

  // 6. SÓ ENTÃO assina. Nada acima pode ser pulado para chegar aqui.
  const startAct = direction === "outbound" ? "call.start" : "call.accept";
  const common = { sc: "call" as const, org: caller.orgId, sub: caller.userId, sid: tcSessionId, cid: callId, peer, lead: leadId };

  const [start, media, ctl] = await Promise.all([
    signCallToken({ ...common, act: [startAct], ttlSeconds: TTL_START_SECONDS }),
    signCallToken({ ...common, act: ["call.media"], ttlSeconds: TTL_MEDIA_SECONDS }),
    signCallToken({ ...common, act: ["call.end"], ttlSeconds: TTL_CTL_SECONDS }),
  ]);

  await logRuntime({
    organizationId: caller.orgId,
    module: "voip",
    action: "call_authorized",
    status: "success",
    entityType: "voip_call",
    entityId: callId,
    payloadSnapshot: {
      direction,
      tc_session_id: tcSessionId,
      lead_id: leadId,
      operator_user_id: caller.userId,
    },
  });

  return {
    ok: true,
    callId,
    peer,
    leadId,
    tokens: { start: start.token, media: media.token, ctl: ctl.token },
    expiresAt: { start: start.expiresAt, media: media.expiresAt, ctl: ctl.expiresAt },
  };
}

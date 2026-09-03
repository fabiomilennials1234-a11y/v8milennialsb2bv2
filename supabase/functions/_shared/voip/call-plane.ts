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
import { toDialDigits } from "./peer-phone.ts";

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
  /**
   * O chamador não ENXERGA o lead sob a RLS de `leads`. Substituiu
   * `not_lead_owner` em 2026-09-02: a condição para ligar deixou de ser "é
   * dono do lead" e passou a ser "vê o lead" — a mesma fronteira da tela.
   */
  | "lead_not_visible"
  /**
   * O operador não opera por ESTA instância. Terceiro caso, distinto dos dois
   * vizinhos: `voice_calls_disabled` é a instância sem voz, `permission_denied`
   * é o usuário sem a feature de voz — aqui os dois existem, e o que falta é o
   * vínculo entre este usuário e este número.
   */
  | "not_instance_member"
  | "permission_denied"
  | "consent_missing"
  | "call_not_answerable"
  | "no_tc_call_id"
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
    tcCallId: string;
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
  | { ok: false; code: "call_not_found" | "call_ended" | "not_operator" | "no_tc_call_id" };

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
    .select("id, organization_id, tc_session_id, tc_call_id, peer_phone, lead_id, operator_user_id, status")
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

  // Sem id de rede não há o que assinar: o cid tem que ser a mesma string que
  // vai no path, senão callIDFor recusa com 404 e o operador não consegue
  // desligar a própria ligação.
  if (!call.tc_call_id) {
    return { ok: false, code: "no_tc_call_id" };
  }

  const t = await signCallToken({
    // Dois atos, não um. `terminate()` em torquecalls-signal usa ESTE token
    // tanto para DELETE /calls/{id} (encerrar) quanto para POST
    // /calls/{id}/reject (recusar chamada de entrada) — a VPS exige o ato
    // `call.reject` na segunda rota, e só emitir `call.end` fazia recusar
    // sempre 401. Terminar e recusar são o mesmo poder sobre a mesma chamada
    // (mesmo operador, mesma linha, mesma janela de 30min): não é ampliação de
    // privilégio, é fechar o contrato que faltava.
    act: ["call.end", "call.reject"],
    ttlSeconds: TTL_CTL_SECONDS,
    org: caller.orgId,
    sub: caller.userId,
    sid: args.tcSessionId,
    cid: call.tc_call_id,
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
    .select("tc_session_id, organization_id, status, whatsapp_instance_id")
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

  // 1b. O operador opera por ESTE número? A sessão carrega a instância, então
  //     sem esta pergunta qualquer membro da org que conheça um `tc_session_id`
  //     disca pelo número de qualquer colega — e esconder o botão no front não
  //     fecha nada, porque o gate é aqui.
  //
  //     A regra NÃO é reimplementada em TypeScript de propósito: quem responde é
  //     `fn_voip_can_use_instance`, a MESMA função que `fn_voip_call_reserve`
  //     consulta logo adiante. Duas cópias da regra é como se fabrica a
  //     divergência entre o que a interface oferece e o que o servidor aceita.
  //     Esta chamada só antecipa a negativa, para o operador receber um motivo
  //     legível em vez de esperar a reserva.
  //
  //     Fail-closed: erro de RPC nega. Um gate que abre quando o banco tosse não
  //     é gate.
  if (session.whatsapp_instance_id) {
    const { data: canUse, error: canUseErr } = await supabaseAdmin.rpc(
      "fn_voip_can_use_instance",
      { p_user_id: caller.userId, p_instance_id: session.whatsapp_instance_id },
    );

    if (canUseErr || canUse !== true) {
      await logRuntime({
        organizationId: caller.orgId,
        module: "voip",
        action: "instance_access_denied",
        status: "error",
        errorMessage: canUseErr?.message,
        payloadSnapshot: {
          user_id: caller.userId,
          whatsapp_instance_id: session.whatsapp_instance_id,
          tc_session_id: tcSessionId,
          direction,
        },
      });
      return deny("not_instance_member");
    }
  }

  // 2. Destino e lead — derivados no servidor, nunca recebidos.
  let leadId: string | null = args.leadId ?? null;
  let peer: string;

  if (direction === "outbound") {
    if (!leadId) return deny("lead_required");

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, organization_id, normalized_phone, phone_digits, phone")
      .eq("id", leadId)
      .maybeSingle();

    if (!lead) return deny("lead_not_found");
    if (lead.organization_id !== caller.orgId) return deny("lead_org_mismatch");

    // `normalized_phone` primeiro de propósito: é a chave canônica, igual para
    // todas as linhas do mesmo contato, e por isso o `peer_phone` do ledger e o
    // teto por destino contam a mesma pessoa uma vez só. O preço é que essa
    // coluna é uma CHAVE DE BUSCA — `normalizePhoneForSearch` remove o DDI de
    // propósito — e o que sai daqui vai para a rede. `toDialDigits` repõe o 55;
    // sem ele a VPS perguntava ao WhatsApp por `+51985960716`, que é Peru.
    peer = toDialDigits(
      digitsOnly(lead.normalized_phone) ||
        digitsOnly(lead.phone_digits) ||
        digitsOnly(lead.phone),
    );
    if (peer.length < 8 || peer.length > 15) return deny("lead_without_phone");

    // 2b. Vê o lead → pode ligar. A fronteira é a RLS de `leads`
    //     (`leads_select_by_responsibility_and_permissions`): a MESMA policy
    //     que decide se o lead aparece na tela, e a mesma que
    //     `voip_calls_select_org` já usava na leitura via
    //     `can_see_lead_by_permissions`. Escrita e leitura coincidem de verdade.
    //
    //     Até 2026-09-02 aqui havia um gate de DONO que se dizia "a mesma
    //     fronteira da leitura" — não era: a leitura era por visibilidade e a
    //     escrita ficou mais estreita. Pior: ele lia colunas LEGADAS de
    //     responsável, espelhadas por trigger e marcadas para drop (#755),
    //     enquanto o produto atribui dono por `pre_sale_responsible_id` /
    //     `sale_responsible_id` — 26 leads tinham dono canônico barrado pelo
    //     gate. E como só ~8% dos leads com conversa têm dono, o botão sumia
    //     justamente para o SDR no chat (medido na Milennials em 2026-09-02).
    //
    //     A regra NÃO é reescrita em TypeScript: quem responde é o banco, com
    //     o JWT do chamador — e a policy já cobre as canônicas
    //     (`is_user_responsible(pre_sale_responsible_id, sale_responsible_id)`)
    //     e as demais portas (admin, `leads.view_all`, funil, gestor). Nenhuma
    //     cópia à mão acompanharia isso. Fail-closed — erro de consulta nega.
    const { data: visible, error: visibleErr } = await caller.asUser
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .maybeSingle();

    if (visibleErr || !visible) {
      await logRuntime({
        organizationId: caller.orgId,
        module: "voip",
        action: "lead_not_visible",
        status: "error",
        errorMessage: visibleErr?.message,
        payloadSnapshot: { user_id: caller.userId, lead_id: leadId, tc_session_id: tcSessionId },
      });
      return deny("lead_not_visible");
    }
  } else {
    if (!args.existingCallId) return deny("call_not_answerable");

    const { data: call } = await supabaseAdmin
      .from("voip_calls")
      .select("id, organization_id, tc_session_id, peer_phone, lead_id, status, tc_call_id")
      .eq("id", args.existingCallId)
      .maybeSingle();

    if (!call) return deny("call_not_answerable");
    if (call.organization_id !== caller.orgId) return deny("session_org_mismatch");
    // A chamada tem que pertencer à SESSÃO nomeada. O gate de instância (1b)
    // resolveu a instância a partir de `tcSessionId`; se a chamada viesse de
    // outra sessão, a autorização teria sido dada sobre a instância errada —
    // nomear a sessão de uma instância aberta para atender uma chamada que
    // chegou numa instância restrita. `renewCallControlToken` já fazia esta
    // conferência; a assimetria entre as duas era o buraco.
    //
    // `fn_voip_call_reserve` também amarra isto no WHERE do UPDATE, que é o gate
    // real. Aqui é a negativa antecipada, com o código que explica o motivo.
    if (call.tc_session_id !== tcSessionId) return deny("call_not_answerable");
    if (call.status !== "ringing" && call.status !== "authorized") {
      return deny("call_not_answerable");
    }
    // Sem id de rede a reserva (fn_voip_call_reserve, achado I1) já nega isto
    // no WHERE do UPDATE, sem efeito colateral. Negar aqui também evita a ida
    // inútil até o banco e dá um código que explica o motivo, em vez de um
    // `call_not_answerable` genérico vindo da RPC.
    if (!call.tc_call_id) return deny("no_tc_call_id");

    // No inbound o número veio do webhook da VPS, já como JID (`555185960716`,
    // 12 dígitos) — `toDialDigits` é no-op sobre ele, por construção. Passa
    // mesmo assim para que exista UMA forma de `peer` neste arquivo: linha
    // antiga, gravada antes deste conserto com 11 dígitos, é reparada aqui em
    // vez de virar um segundo formato circulando pelo mesmo campo.
    peer = toDialDigits(digitsOnly(call.peer_phone));
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
  //    CONDICIONAL desde 2026-07-31, por decisão do CTO: o default é assumir
  //    todo lead consentido, e a exigência volta ligando
  //    `organizations.require_voice_consent`. A trava não foi apagada — ela
  //    continua inteira aqui e em `fn_voip_call_reserve`, que é o gate real;
  //    esta consulta apenas evita a ida até o banco e devolve um código que
  //    explica o motivo.
  //
  //    O que motivou: a regra nunca teve produtor. `fn_voip_consent_record` é
  //    service_role-only e não tem um único chamador; o hook do front grava
  //    `source: 'manual'`, que o gate exclui de propósito. Produção tinha ZERO
  //    linhas de `voice_call_whatsapp` — a trava era total na prática, e
  //    nenhuma ligação de saída era autorizável por caminho de produto.
  let consentRecordId: string | null = null;
  if (direction === "outbound") {
    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("require_voice_consent")
      .eq("id", caller.orgId)
      .maybeSingle();

    // Ausência resolve para "não exige" — mesmo default da coluna. Uma org sem
    // linha legível não pode virar trava silenciosa.
    if (org?.require_voice_consent === true) {
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

  const result = reserved as {
    ok: boolean;
    code?: string;
    call_id?: string;
    tc_call_id?: string;
    retry_after_ms?: number;
  };
  if (!result.ok) {
    return deny((result.code ?? "reserve_failed") as DenyCode, result.retry_after_ms);
  }

  const callId = result.call_id!;
  const tcCallId = result.tc_call_id;

  // Fail-closed. Assinar sem id de rede produz um token que a VPS recusa por
  // formato, e o sintoma chega como "a chamada não completa" em vez de como
  // erro de contrato. A reserva já foi feita, então o log tem que registrar
  // para a linha órfã ser explicável depois.
  if (!tcCallId) {
    await logRuntime({
      organizationId: caller.orgId,
      module: "voip",
      action: "reserve_sem_tc_call_id",
      status: "error",
      entityType: "voip_call",
      entityId: callId,
    });
    return deny("reserve_failed");
  }

  // 6. SÓ ENTÃO assina. Nada acima pode ser pulado para chegar aqui.
  //
  // O cid é o id de REDE, não o uuid da linha. São coisas diferentes: o uuid
  // identifica o registro no ledger; o cid é o que a VPS conhece, o que
  // validCallID valida, e o que vai no path das rotas de accept, end, reject e
  // webrtc — onde callIDFor compara os dois.
  const startAct = direction === "outbound" ? "call.start" : "call.accept";
  const common = {
    sc: "call" as const,
    org: caller.orgId,
    sub: caller.userId,
    sid: tcSessionId,
    cid: tcCallId,
    peer,
    lead: leadId,
  };

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
    tcCallId,
    peer,
    leadId,
    tokens: { start: start.token, media: media.token, ctl: ctl.token },
    expiresAt: { start: start.expiresAt, media: media.expiresAt, ctl: ctl.expiresAt },
  };
}

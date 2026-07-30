/**
 * Cliente do plano de sinalização de voz (TorqueCalls, S14).
 *
 * Duas fronteiras, e a diferença entre elas é a coisa mais importante deste
 * arquivo:
 *
 *   1. `torquecalls-signal` (edge function do CRM) — autenticada pelo JWT do
 *      usuário, que o supabase-js já anexa. É quem decide se a chamada pode
 *      acontecer e emite as credenciais.
 *   2. A VPS — nunca recebe o JWT do usuário. Recebe as credenciais de curta
 *      duração que a edge function emitiu, cada uma para uma coisa só.
 *
 * O navegador não escolhe org, operador nem número de destino. Ele diz "ligar
 * para este lead" e recebe de volta o que pode fazer.
 */
import { supabase } from "@/integrations/supabase/client";

export interface StartCallResult {
  callId: string;
  tcCallId: string | null;
  /** Dígitos do destino, derivados do lead pelo servidor. Só para exibir. */
  peer: string;
  /** Credencial de mídia (90s) — troca de SDP com a VPS. */
  media: string;
  /** Credencial de encerrar (30min) — desligar não pode depender da rede do CRM. */
  ctl: string;
  vpsUrl: string;
}

export interface StreamTokenResult {
  token: string;
  expiresAt: number;
  renewInMs: number;
  vpsUrl: string;
}

/**
 * Códigos de recusa do governor. Traduzidos aqui, uma vez, porque a mesma
 * negativa aparece no botão, no toast e no painel — e três traduções divergem.
 */
export const CALL_DENY_MESSAGES: Record<string, string> = {
  voice_calls_disabled: "Chamada de voz está desligada para este número.",
  consent_missing: "Este lead ainda não autorizou receber ligações.",
  lead_required: "Selecione um lead para ligar.",
  lead_without_phone: "Este lead não tem telefone.",
  not_lead_owner: "Este lead não é seu.",
  permission_denied: "Você não tem permissão para ligar.",
  operator_busy: "Você já está em uma chamada.",
  org_concurrency_reached: "Todas as linhas de voz estão ocupadas.",
  daily_cap_reached: "Limite diário de chamadas atingido.",
  rate_limited: "Muitas chamadas em pouco tempo. Aguarde um instante.",
  peer_daily_cap_reached: "Já foram feitas ligações demais para este número hoje.",
  peer_backoff: "Este número não atendeu há pouco. Tente mais tarde.",
  session_not_open: "O número de chamadas não está conectado.",
  session_not_found: "Nenhum número de chamadas configurado.",
  call_not_answerable: "Esta chamada não está mais disponível.",
  vps_refused: "O serviço de chamadas recusou a ligação.",
};

export class CallDeniedError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs?: number,
  ) {
    super(CALL_DENY_MESSAGES[code] ?? "Não foi possível completar a chamada.");
    this.name = "CallDeniedError";
  }
}

async function signal<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("torquecalls-signal", {
    body: { action, ...body },
  });

  if (error) {
    // O corpo do erro carrega o código do governor; sem ele a UI só saberia
    // dizer "falhou", que é a mensagem que faz o vendedor abrir chamado.
    const ctx = (error as { context?: { body?: unknown } }).context;
    const parsed = await readErrorBody(ctx?.body);
    if (parsed?.code) throw new CallDeniedError(parsed.code, parsed.retry_after_ms);
    throw new Error(error.message ?? "Falha ao falar com o serviço de chamadas");
  }

  const payload = data as { code?: string; retry_after_ms?: number } | null;
  if (payload?.code) throw new CallDeniedError(payload.code, payload.retry_after_ms);

  return data as T;
}

async function readErrorBody(
  body: unknown,
): Promise<{ code?: string; retry_after_ms?: number } | null> {
  try {
    if (!body) return null;
    if (typeof body === "string") return JSON.parse(body);
    if (body instanceof Response) return await body.json();
    if (typeof body === "object") return body as { code?: string };
  } catch {
    return null;
  }
  return null;
}

export async function startCall(args: {
  tcSessionId: string;
  leadId: string;
}): Promise<StartCallResult> {
  const raw = await signal<{
    call_id: string;
    tc_call_id: string | null;
    peer: string;
    media: string;
    ctl: string;
    vps_url: string;
  }>("startCall", { tc_session_id: args.tcSessionId, lead_id: args.leadId });

  return {
    callId: raw.call_id,
    tcCallId: raw.tc_call_id,
    peer: raw.peer,
    media: raw.media,
    ctl: raw.ctl,
    vpsUrl: raw.vps_url,
  };
}

export async function endCall(args: { tcSessionId: string; callId: string }): Promise<void> {
  await signal("endCall", { tc_session_id: args.tcSessionId, call_id: args.callId });
}

export async function requestStreamToken(args: {
  tcSessionId: string;
}): Promise<StreamTokenResult> {
  const raw = await signal<{
    token: string;
    expires_at: number;
    renew_in_ms: number;
    vps_url: string;
  }>("streamToken", { tc_session_id: args.tcSessionId });

  return {
    token: raw.token,
    expiresAt: raw.expires_at,
    renewInMs: raw.renew_in_ms,
    vpsUrl: raw.vps_url,
  };
}

/**
 * Troca de SDP com a VPS.
 *
 * Único ponto do frontend que fala com a VPS, e só com a credencial de mídia —
 * que vale 90 segundos e autoriza exatamente esta chamada. O token vai em
 * cabeçalho, NUNCA em query string: query vaza para log de proxy, histórico do
 * navegador e Referer.
 */
export async function exchangeSdp(args: {
  vpsUrl: string;
  tcSessionId: string;
  tcCallId: string;
  mediaToken: string;
  sdpOffer: string;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(
    `${args.vpsUrl}/api/sessions/${encodeURIComponent(args.tcSessionId)}` +
      `/calls/${encodeURIComponent(args.tcCallId)}/webrtc`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.mediaToken}`,
      },
      body: JSON.stringify({ sdp_offer: args.sdpOffer }),
      signal: args.signal,
    },
  );

  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "A credencial de mídia expirou. Tente ligar de novo."
        : `Falha na negociação de áudio (${res.status})`,
    );
  }

  const body = (await res.json()) as { sdp_answer?: string };
  if (!body.sdp_answer) throw new Error("A VPS não devolveu a resposta de áudio");
  return body.sdp_answer;
}

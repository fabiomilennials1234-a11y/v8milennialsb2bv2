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
    const parsed = await readInvokeErrorBody(error);
    if (parsed?.code) throw new CallDeniedError(parsed.code, parsed.retry_after_ms);
    throw new Error(error.message ?? "Falha ao falar com o serviço de chamadas");
  }

  const payload = data as { code?: string; retry_after_ms?: number } | null;
  if (payload?.code) throw new CallDeniedError(payload.code, payload.retry_after_ms);

  return data as T;
}

/**
 * Extrai o corpo de uma recusa do `functions.invoke`.
 *
 * Quando a edge function responde com status de erro, o client devolve
 * `data: null` e põe a resposta HTTP crua em `error.context` — um `Response`
 * ainda não lido. Ler `data?.code` nesse caminho devolve `undefined` **sempre**,
 * e todo código de recusa vira "unknown": o cliente veria a mensagem genérica
 * em vez de "desconecte um número antes de ligar outro". O padrão correto já
 * existe no repositório, em `useOmie.ts` (`extractFunctionError`).
 *
 * Aceita `Response` por instância ou por presença de `.json()` para não depender
 * do ambiente ter a classe global — o teste roda em jsdom.
 */
export async function readInvokeErrorBody(
  error: unknown,
): Promise<{ code?: string; error?: string; retry_after_ms?: number } | null> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (!ctx) return null;
  const asResponse = ctx as { json?: () => Promise<unknown>; text?: () => Promise<string> };
  if (typeof asResponse.json !== "function") return null;
  try {
    return (await asResponse.json()) as { code?: string; error?: string; retry_after_ms?: number };
  } catch {
    try {
      const text = typeof asResponse.text === "function" ? await asResponse.text() : "";
      return text ? (JSON.parse(text) as { code?: string }) : null;
    } catch {
      return null;
    }
  }
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

/**
 * Mensagens das recusas do plano de controle. Sem esta tabela o cliente vê o
 * código cru — e "session_cap_reached" não diz a ninguém o que fazer.
 *
 * NÃO tem entrada para "4 aparelhos já vinculados" (o limite do próprio
 * WhatsApp). Verificado: nenhum caminho hoje produz um código para esse caso.
 * O rejeite acontece DEPOIS do QR ser escaneado — evento assíncrono da VPS,
 * não resposta HTTP de `pairSession` — e nem o corpo de erro da VPS
 * (`_shared/voip/vps.ts`) nem o `SessionEvent` do stream (`torquecallsEvents.ts`)
 * carregam campo de código para essa rejeição. Colocar uma tradução aqui sem
 * um código que a alcance seria só uma mensagem morta, dando a falsa
 * confiança de que o caso já está tratado.
 */
export const VOICE_CONTROL_MESSAGES: Record<string, string> = {
  voice_feature_off:
    "A chamada de voz não está incluída no plano desta organização.",
  session_cap_reached:
    "Limite de números com voz atingido. Desconecte um número antes de ligar outro.",
  session_orphaned:
    "O número foi criado no servidor de voz mas não ficou registrado aqui. Tente de novo — o sistema vai adotar o que já existe.",
};

export class VoiceControlError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? VOICE_CONTROL_MESSAGES[code] ?? "Não foi possível concluir a operação.");
    this.name = "VoiceControlError";
  }
}

async function control<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("torquecalls-control", {
    body: { action, ...body },
  });
  if (error) {
    // Mesma fronteira de `signal()`: com `error` setado, `data` vem `null` e o
    // corpo real mora em `error.context`. Ler `data?.code` aqui devolvia
    // "unknown" SEMPRE — nenhuma das três traduções desta tabela jamais
    // disparava.
    const parsed = await readInvokeErrorBody(error);
    throw new VoiceControlError(parsed?.code ?? "unknown", parsed?.error);
  }
  return data as T;
}

export async function createVoiceSession(args: {
  whatsappInstanceId: string;
  name?: string;
}): Promise<{ tcSessionId: string }> {
  const data = await control<{ tc_session_id: string }>("createSession", {
    whatsapp_instance_id: args.whatsappInstanceId,
    name: args.name ?? "TorqueCalls",
  });
  return { tcSessionId: data.tc_session_id };
}

/** Pede um QR novo para uma sessão que já existe, sem criar outra. */
export async function pairVoiceSession(args: { tcSessionId: string }): Promise<void> {
  await control("pairSession", { tc_session_id: args.tcSessionId });
}

export async function logoutVoiceSession(args: { tcSessionId: string }): Promise<void> {
  await control("logoutSession", { tc_session_id: args.tcSessionId });
}

export async function requestStreamToken(args: {
  tcSessionId: string;
  /** Só true quando a tela precisa do QR — o servidor exige permissão extra. */
  pair?: boolean;
}): Promise<StreamTokenResult> {
  const raw = await signal<{
    token: string;
    expires_at: number;
    renew_in_ms: number;
    vps_url: string;
  }>("streamToken", {
    tc_session_id: args.tcSessionId,
    ...(args.pair ? { pair: true } : {}),
  });

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

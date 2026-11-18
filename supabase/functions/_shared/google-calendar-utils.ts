/**
 * Utilitários compartilhados para integração com Google Calendar
 * Usados pelas Edge Functions: connect, callback, disconnect, events, webhook, sharing
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constantes de ambiente ───────────────────────────────────────────────────
export const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID")     ?? "";
export const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
export const GOOGLE_REDIRECT_URI  = Deno.env.get("GOOGLE_REDIRECT_URI")  ?? "";
export const ENCRYPTION_KEY_HEX   = Deno.env.get("GOOGLE_CALENDAR_ENCRYPTION_KEY") ?? "";
export const ENCRYPTION_KEY_ID    = "v1";

// NOTE: usamos apenas `calendar.events` (escopo SENSÍVEL), não `calendar` (RESTRITO).
// Todas as chamadas da API batem em /calendars/primary/events, events/watch e channels/stop
// — nenhuma usa ACL/calendarList/freebusy. O "compartilhamento" é interno (tabela
// google_calendar_sharing), não usa ACL nativo do Google. Manter escopo restrito exigiria
// verificação + auditoria CASA do Google sem necessidade. Ver docs/GOOGLE_CALENDAR_OAUTH_PLAN.md.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "email",
  "profile",
].join(" ");

// ─── Conversão Base64 ────────────────────────────────────────────────────────

function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

// `Uint8Array<ArrayBuffer>` e não `Uint8Array` pelado: desde o TS 5.7 o tipo é
// genérico e `Uint8Array` sozinho significa `Uint8Array<ArrayBufferLike>`, que
// admite `SharedArrayBuffer` e por isso não satisfaz o `BufferSource` exigido
// por `crypto.subtle.importKey`/`decrypt`. O valor devolvido já vem de
// `new Uint8Array(...)` — a anotação frouxa é que jogava a informação fora.
function base64Decode(str: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    atob(str)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/.{2}/g);
  if (!pairs) throw new Error("Chave de criptografia inválida");
  return new Uint8Array(pairs.map((b) => parseInt(b, 16)));
}

// ─── Criptografia AES-256-GCM ────────────────────────────────────────────────

export async function encryptToken(
  token: string
): Promise<{ encrypted: string; nonce: string }> {
  if (!ENCRYPTION_KEY_HEX) {
    throw new Error("GOOGLE_CALENDAR_ENCRYPTION_KEY não configurada");
  }
  const keyBytes = hexToBytes(ENCRYPTION_KEY_HEX);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(token);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    encoded
  );
  return {
    encrypted: base64Encode(new Uint8Array(encrypted)),
    nonce: base64Encode(nonce),
  };
}

export async function decryptToken(
  encrypted: string,
  nonce: string
): Promise<string> {
  if (!ENCRYPTION_KEY_HEX) {
    throw new Error("GOOGLE_CALENDAR_ENCRYPTION_KEY não configurada");
  }
  const keyBytes = hexToBytes(ENCRYPTION_KEY_HEX);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  const iv = base64Decode(nonce);
  const encryptedBytes = base64Decode(encrypted);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedBytes
  );
  return new TextDecoder().decode(decrypted);
}

// ─── OAuth state ─────────────────────────────────────────────────────────────
// Assinado (HMAC) com nonce de uso único: ver ./google-calendar-oauth-state.ts.
// O encodeState/decodeState em base64 puro que vivia aqui era forjável.

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(
      `Falha ao renovar token: ${err.error_description ?? err.error}`
    );
  }
  return response.json();
}

// ─── Obtém access token válido (decodifica + renova) ─────────────────────────

export async function getValidAccessToken(
  userId: string,
  supabase: SupabaseClient
): Promise<{ accessToken: string; googleEmail: string } | null> {
  const { data: tokenRecord } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenRecord) return null;

  const refreshToken = await decryptToken(
    tokenRecord.encrypted_refresh_token,
    tokenRecord.encryption_nonce
  );

  const refreshed = await refreshAccessToken(refreshToken);

  await supabase
    .from("google_calendar_tokens")
    .update({
      access_token_expires_at: new Date(
        Date.now() + refreshed.expires_in * 1000
      ).toISOString(),
      last_sync_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("user_id", userId);

  return {
    accessToken: refreshed.access_token,
    googleEmail: tokenRecord.google_email,
  };
}

// ─── Registro de watch channel (push notifications) ──────────────────────────

const GOOGLE_WATCH_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch";
const GOOGLE_STOP_URL  = "https://www.googleapis.com/calendar/v3/channels/stop";
const WATCH_CALENDAR_ID = "primary";

/** Janela antes da expiração em que o canal ativo é renovado. */
export const WATCH_RENEWAL_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Decide se o canal ativo precisa ser renovado, a partir da `expiration`
 * gravada no BANCO (não do header da notificação). Sem expiração conhecida,
 * não renova — renovar às cegas a cada notificação é o que alimentou a
 * multiplicação de canais do incidente de 2026-11-16.
 */
export function watchChannelNeedsRenewal(
  expiration: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!expiration) return false;
  const expiresAt = Date.parse(expiration);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt - nowMs < WATCH_RENEWAL_WINDOW_MS;
}

/**
 * Para um canal no Google. Best-effort: nunca lança.
 * Devolve o status HTTP do Google (204 = parado, 404 = já não existia) ou
 * null em falha de rede — quem só quer "tentar" pode ignorar o retorno.
 */
export async function stopGoogleChannel(
  accessToken: string,
  channelId: string,
  resourceId: string,
): Promise<number | null> {
  try {
    const res = await fetch(GOOGLE_STOP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: channelId, resourceId }),
    });
    // Corpo descartado: libera a conexão sem segurar o buffer.
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch (err) {
    console.warn("[GoogleCalendar] Falha ao parar watch channel:", channelId, err);
    return null;
  }
}

// ─── Token do watch channel ─────────────────────────────────────────────────
//
// O Google devolve o `token` do events/watch em X-Goog-Channel-Token a cada
// notificação. Só o SHA-256 vai para o banco (o dono lê a própria linha).

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateWatchChannelToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashWatchChannelToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

/**
 * Valida o X-Goog-Channel-Token contra o hash gravado no canal.
 * `storedHash` nulo = canal legado (registrado antes do token): aceito aqui; o
 * webhook só chega a esta checagem se o legado ainda não expirou. A renovação
 * grava o hash do canal novo. Com hash gravado, header ausente
 * ou divergente é recusado. Comparação em tempo constante.
 */
export async function isWatchChannelTokenValid(
  headerToken: string | null,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return true;
  if (!headerToken) return false;
  const got = await hashWatchChannelToken(headerToken);
  if (got.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}

interface ReplaceWatchChannelResult {
  won: boolean;
  stopped: Array<{ channel_id: string; resource_id: string | null }>;
}

/**
 * Cria um watch channel no Google e o torna o ÚNICO ativo de
 * (userId, "primary"), via `replace_google_watch_channel` (atômico).
 *
 * - Sem `expectedOldChannelId` (conexão/reconexão OAuth): substitui todos os
 *   ativos do usuário e para os antigos no Google.
 * - Com `expectedOldChannelId` (renovação pelo webhook): compare-and-swap.
 *   Se outro processo já renovou, este perde, e o canal recém-criado é parado
 *   no Google para não ficar órfão disparando notificações.
 *
 * Nunca lança: falha aqui não pode bloquear o OAuth nem o webhook.
 */
export async function registerWatchChannel(
  userId: string,
  orgId: string,
  accessToken: string,
  supabase: SupabaseClient,
  expectedOldChannelId?: string,
): Promise<{ renewed: boolean }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const channelId = crypto.randomUUID();
  const channelToken = generateWatchChannelToken();
  const webhookUrl = `${supabaseUrl}/functions/v1/google-calendar-webhook`;

  let data: { resourceId?: string; expiration?: string };
  try {
    const response = await fetch(GOOGLE_WATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
        token: channelToken,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => null);
      console.error("[GoogleCalendar] Erro ao registrar watch channel:", err);
      return { renewed: false };
    }

    data = await response.json();
  } catch (err) {
    console.error("[GoogleCalendar] Falha de rede ao registrar watch channel:", err);
    return { renewed: false };
  }

  const resourceId = data.resourceId ?? null;
  const expiration = data.expiration
    ? new Date(parseInt(data.expiration, 10)).toISOString()
    : null;

  const { data: result, error } = await supabase.rpc("replace_google_watch_channel", {
    p_user_id: userId,
    p_org_id: orgId,
    p_calendar_id: WATCH_CALENDAR_ID,
    p_channel_id: channelId,
    p_resource_id: resourceId,
    p_expiration: expiration,
    p_expected_old_channel_id: expectedOldChannelId ?? null,
  });

  if (error) {
    console.error("[GoogleCalendar] Erro ao gravar watch channel:", error);
    // Com `code`, o Postgres respondeu e a transação foi desfeita: o canal novo
    // não tem linha no banco e só viraria órfão — para no Google. (Ex.: connect
    // manda orgId "" e o cast para uuid quebra a cada conexão.)
    // Sem `code` é erro de transporte (timeout): o commit pode ter acontecido,
    // e parar o canal que o banco tem como ativo deixaria a agenda muda. Aí só
    // loga; se for órfão, expira sozinho e cai no early-return do webhook.
    if (error.code && resourceId) {
      await stopGoogleChannel(accessToken, channelId, resourceId);
    }
    return { renewed: false };
  }

  const outcome = result as ReplaceWatchChannelResult | null;

  if (!outcome?.won) {
    // Outro processo renovou primeiro. O canal recém-criado não tem linha
    // ativa no banco: para no Google para não virar mais uma fonte de webhook.
    if (resourceId) await stopGoogleChannel(accessToken, channelId, resourceId);
    return { renewed: false };
  }

  // Hash do token na linha recém-ativada. Fora da RPC para não mudar a
  // assinatura de replace_google_watch_channel; a janela entre o INSERT e este
  // UPDATE só aceita o canal como legado (hash NULL), nunca recusa o legítimo.
  const { error: tokenError } = await supabase
    .from("google_calendar_watch_channels")
    .update({ channel_token_hash: await hashWatchChannelToken(channelToken) })
    .eq("channel_id", channelId);
  if (tokenError) {
    console.error("[GoogleCalendar] Erro ao gravar hash do token do canal:", tokenError);
  }

  for (const old of outcome.stopped ?? []) {
    if (old.resource_id) {
      await stopGoogleChannel(accessToken, old.channel_id, old.resource_id);
    }
  }

  return { renewed: true };
}

// ─── Cancelamento de watch channel ──────────────────────────────────────────

export async function cancelWatchChannels(
  userId: string,
  accessToken: string,
  supabase: SupabaseClient
): Promise<void> {
  const { data: channels } = await supabase
    .from("google_calendar_watch_channels")
    .select("channel_id, resource_id")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (!channels?.length) return;

  for (const ch of channels) {
    if (!ch.resource_id) continue;
    await stopGoogleChannel(accessToken, ch.channel_id, ch.resource_id);
  }

  await supabase
    .from("google_calendar_watch_channels")
    .update({ is_active: false })
    .eq("user_id", userId);
}

// ─── Auditoria ───────────────────────────────────────────────────────────────

export async function logCalendarOp(
  supabase: SupabaseClient,
  params: {
    userId: string;
    operation: string;
    status: "success" | "failed" | "pending";
    googleEventId?: string;
    localReferenceId?: string;
    localReferenceType?: string;
    errorMessage?: string;
    requestPayload?: Record<string, unknown>;
    responsePayload?: Record<string, unknown>;
    initiatedBy?: "user" | "ai_agent" | "system";
  }
): Promise<void> {
  await supabase.from("google_calendar_sync_logs").insert({
    user_id: params.userId,
    operation: params.operation,
    status: params.status,
    google_event_id: params.googleEventId ?? null,
    local_reference_id: params.localReferenceId ?? null,
    local_reference_type: params.localReferenceType ?? null,
    error_message: params.errorMessage ?? null,
    request_payload: params.requestPayload ?? null,
    response_payload: params.responsePayload ?? null,
    initiated_by: params.initiatedBy ?? "user",
  });
}

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

// ─── OAuth state (CSRF protection) ───────────────────────────────────────────

export function encodeState(userId: string, orgId: string): string {
  const payload = JSON.stringify({ userId, orgId, ts: Date.now() });
  return btoa(payload);
}

export function decodeState(
  state: string
): { userId: string; orgId: string; ts: number } | null {
  try {
    const payload = JSON.parse(atob(state));
    // Rejeita states com mais de 15 minutos
    if (Date.now() - payload.ts > 15 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

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

// ─── Obtém access token válido (reaproveita ou renova) ───────────────────────
//
// Perf F5c (RAM/pool do PostgREST, 19/10): antes, TODA leitura de agenda
// renovava o token no Google e fazia UPDATE na linha do dono — em série por dono
// no GET de eventos, com disputa de lock na mesma linha (~1,7% do tempo do banco).
// O access token do Google vale ~1 h; agora ele fica cifrado em
// `access_token_cache` e é reaproveitado até `exp - margem`.
//
// O cache carrega o `encryption_nonce` do refresh token que o gerou: o callback
// de OAuth regrava o refresh token (nonce novo) na reconexão, e isso invalida o
// cache sozinho — nunca reaproveitamos access token de uma concessão anterior.

/** Renova antes de vencer: cobre relógio torto e a duração da chamada à API. */
export const ACCESS_TOKEN_REUSE_MARGIN_MS = 5 * 60 * 1000;

interface AccessTokenCache {
  /** access token em claro (só existe cifrado no banco). */
  t: string;
  /** vencimento ISO devolvido pelo Google na renovação. */
  exp: string;
  /** `encryption_nonce` do refresh token que gerou este access token. */
  rn: string;
}

async function lerCacheDeAccessToken(
  tokenRecord: Record<string, unknown>,
  now: number
): Promise<string | null> {
  const blob = tokenRecord.access_token_cache;
  if (typeof blob !== "string" || !blob) return null;
  const sep = blob.indexOf(".");
  if (sep <= 0) return null;
  try {
    const cache = JSON.parse(
      await decryptToken(blob.slice(sep + 1), blob.slice(0, sep))
    ) as Partial<AccessTokenCache>;
    if (typeof cache.t !== "string" || typeof cache.exp !== "string") return null;
    if (cache.rn !== tokenRecord.encryption_nonce) return null;
    const exp = Date.parse(cache.exp);
    if (!Number.isFinite(exp) || exp - ACCESS_TOKEN_REUSE_MARGIN_MS <= now) return null;
    return cache.t;
  } catch {
    // Cifra inválida (blob corrompido, chave trocada): renovar é o caminho seguro.
    return null;
  }
}

export async function getValidAccessToken(
  userId: string,
  supabase: SupabaseClient,
  deps: {
    now?: () => number;
    refresh?: typeof refreshAccessToken;
  } = {}
): Promise<{ accessToken: string; googleEmail: string } | null> {
  const now = (deps.now ?? Date.now)();
  const refresh = deps.refresh ?? refreshAccessToken;

  const { data: tokenRecord } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenRecord) return null;

  const emCache = await lerCacheDeAccessToken(tokenRecord, now);
  if (emCache) {
    return { accessToken: emCache, googleEmail: tokenRecord.google_email };
  }

  const refreshToken = await decryptToken(
    tokenRecord.encrypted_refresh_token,
    tokenRecord.encryption_nonce
  );

  const refreshed = await refresh(refreshToken);
  const expiresAt = new Date(now + refreshed.expires_in * 1000).toISOString();

  const cifrado = await encryptToken(
    JSON.stringify({
      t: refreshed.access_token,
      exp: expiresAt,
      rn: tokenRecord.encryption_nonce,
    } satisfies AccessTokenCache)
  );

  const base = {
    access_token_expires_at: expiresAt,
    last_sync_at: new Date(now).toISOString(),
    last_error: null,
  };

  const { error } = await supabase
    .from("google_calendar_tokens")
    .update({ ...base, access_token_cache: `${cifrado.nonce}.${cifrado.encrypted}` })
    .eq("user_id", userId);

  if (error) {
    // Coluna ainda inexistente (migration não aplicada) ou outra falha: grava o
    // que o código antigo gravava. A edge fn pode subir antes da migration.
    console.warn("[GoogleCalendar] cache do access token não gravado:", error.code ?? error.message);
    await supabase.from("google_calendar_tokens").update(base).eq("user_id", userId);
  }

  return {
    accessToken: refreshed.access_token,
    googleEmail: tokenRecord.google_email,
  };
}

// ─── Registro de watch channel (push notifications) ──────────────────────────

export async function registerWatchChannel(
  userId: string,
  orgId: string,
  accessToken: string,
  supabase: SupabaseClient
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const channelId = crypto.randomUUID();
  const webhookUrl = `${supabaseUrl}/functions/v1/google-calendar-webhook`;

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    console.error("[GoogleCalendar] Erro ao registrar watch channel:", err);
    // Não bloqueia o fluxo OAuth — apenas loga
    return;
  }

  const data = await response.json();

  await supabase.from("google_calendar_watch_channels").insert({
    user_id: userId,
    organization_id: orgId,
    channel_id: channelId,
    resource_id: data.resourceId ?? null,
    calendar_id: "primary",
    expiration: data.expiration
      ? new Date(parseInt(data.expiration)).toISOString()
      : null,
    is_active: true,
  });
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
    await fetch("https://www.googleapis.com/calendar/v3/channels/stop", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: ch.channel_id, resourceId: ch.resource_id }),
    }).catch(() => {}); // best-effort
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

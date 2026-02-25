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

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "email",
  "profile",
].join(" ");

// ─── Conversão Base64 ────────────────────────────────────────────────────────

function base64Encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64Decode(str: string): Uint8Array {
  return new Uint8Array(
    atob(str)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
}

function hexToBytes(hex: string): Uint8Array {
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

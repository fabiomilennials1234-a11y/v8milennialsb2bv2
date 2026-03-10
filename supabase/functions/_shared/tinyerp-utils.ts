/**
 * Utilitários compartilhados para integração com TinyERP
 * Usados pelas Edge Functions: connect, disconnect, proxy, sync-products, push-order, webhook
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constantes ─────────────────────────────────────────────────────────────

export const TINY_API_BASE = "https://api.tiny.com.br/api2";
export const ENCRYPTION_KEY_HEX = Deno.env.get("TINYERP_ENCRYPTION_KEY") ?? "";
export const ENCRYPTION_KEY_ID = "v1";

// ─── Conversão Base64 ───────────────────────────────────────────────────────

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

// ─── Criptografia AES-256-GCM ──────────────────────────────────────────────

export async function encryptToken(
  token: string
): Promise<{ encrypted: string; nonce: string }> {
  if (!ENCRYPTION_KEY_HEX) {
    throw new Error("TINYERP_ENCRYPTION_KEY não configurada");
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
    throw new Error("TINYERP_ENCRYPTION_KEY não configurada");
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

// ─── TinyERP API Helper ────────────────────────────────────────────────────

export interface TinyApiResponse {
  retorno: {
    status_processamento: string; // "1" = sucesso, "2" = erro parcial, "3" = erro
    status: string;
    codigo_erro?: number;
    erros?: Array<{ erro: string }> | Record<string, string>;
    [key: string]: unknown;
  };
}

/**
 * Extracts error message from TinyERP response.
 * TinyERP `erros` can be an array [{erro: "..."}] OR an object {erro: "..."}.
 */
export function getTinyErrorMessage(response: TinyApiResponse): string {
  const erros = response.retorno.erros;
  if (Array.isArray(erros) && erros.length > 0) {
    return erros[0]?.erro || "";
  }
  if (erros && typeof erros === "object" && !Array.isArray(erros)) {
    return (erros as Record<string, string>).erro || "";
  }
  return response.retorno.status || "";
}

/**
 * Checks if TinyERP error is "no records found" (not an actual error).
 */
export function isTinyNoRecordsError(response: TinyApiResponse): boolean {
  if (response.retorno.status_processamento !== "3") return false;
  const msg = getTinyErrorMessage(response).toLowerCase();
  return msg.includes("nenhum registro") || msg.includes("não há registros");
}

export async function callTinyApi(
  token: string,
  action: string,
  params: Record<string, unknown> = {}
): Promise<TinyApiResponse> {
  const url = `${TINY_API_BASE}/${action}`;

  const formData = new URLSearchParams();
  formData.set("token", token);
  formData.set("formato", "json");

  // Add extra params
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      formData.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`TinyERP API HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data as TinyApiResponse;
}

// ─── Logging Helper ────────────────────────────────────────────────────────

export async function logTinyOp(
  supabase: SupabaseClient,
  params: {
    organization_id: string;
    operation: string;
    status: string;
    error_message?: string;
    items_processed?: number;
    items_created?: number;
    items_updated?: number;
    items_failed?: number;
    local_reference_id?: string;
    local_reference_type?: string;
    tiny_reference_id?: string;
    request_payload?: unknown;
    response_payload?: unknown;
    initiated_by?: string;
  }
): Promise<void> {
  const { error } = await supabase.from("tinyerp_sync_logs").insert({
    organization_id: params.organization_id,
    operation: params.operation,
    status: params.status,
    error_message: params.error_message || null,
    items_processed: params.items_processed || 0,
    items_created: params.items_created || 0,
    items_updated: params.items_updated || 0,
    items_failed: params.items_failed || 0,
    local_reference_id: params.local_reference_id || null,
    local_reference_type: params.local_reference_type || null,
    tiny_reference_id: params.tiny_reference_id || null,
    request_payload: params.request_payload || null,
    response_payload: params.response_payload || null,
    initiated_by: params.initiated_by || "user",
  });

  if (error) {
    console.error("[TinyERP] Failed to log operation:", error);
  }
}

// ─── Get decrypted token for an organization ────────────────────────────────

export async function getOrgTinyToken(
  supabase: SupabaseClient,
  organizationId: string
): Promise<{ token: string; connectionId: string } | null> {
  const { data, error } = await supabase
    .from("tinyerp_connections")
    .select("id, encrypted_api_token, encryption_nonce, status")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .maybeSingle();

  if (error || !data) return null;

  try {
    const token = await decryptToken(data.encrypted_api_token, data.encryption_nonce);
    return { token, connectionId: data.id };
  } catch {
    return null;
  }
}

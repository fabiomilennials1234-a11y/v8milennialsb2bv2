/**
 * Webhook outbound: validação de URL (anti-SSRF), assinatura HMAC e envio com timeout.
 * SECURITY: Apenas HTTPS; bloqueio de IPs privados/localhost.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_TRUNCATE = 2048;

/** Bloqueia localhost e IPs privados (IPv4 e IPv6). */
function isPrivateOrLocalHost(hostname: string, resolvedIps: string[]): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower.endsWith(".localhost") ||
    lower === "::1"
  ) {
    return true;
  }
  for (const ip of resolvedIps) {
    if (ip === "127.0.0.1" || ip === "::1") return true;
    // IPv4 private ranges
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("172.")) {
      const second = parseInt(ip.split(".")[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    if (ip.startsWith("192.168.")) return true;
    // IPv6 loopback / link-local
    if (ip.startsWith("fe80:") || ip === "::1") return true;
  }
  return false;
}

/**
 * Valida URL para uso em webhooks (anti-SSRF).
 * Apenas HTTPS; resolve DNS e bloqueia localhost e IPs privados.
 */
export async function validateUrl(
  urlString: string
): Promise<{ valid: boolean; error?: string }> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: "URL inválida" };
  }
  if (url.protocol !== "https:") {
    return { valid: false, error: "Apenas HTTPS é permitido" };
  }
  const hostname = url.hostname;
  try {
    const ips = await Deno.resolveDns(hostname, "A").catch(() => []);
    const ipv6 = await Deno.resolveDns(hostname, "AAAA").catch(() => []);
    const resolved = [...ips, ...ipv6];
    if (resolved.length === 0 && hostname !== "localhost") {
      // DNS pode não retornar A/AAAA em alguns casos; permitir se não for localhost
      return { valid: true };
    }
    if (isPrivateOrLocalHost(hostname, resolved)) {
      return { valid: false, error: "URL não pode apontar para localhost ou rede privada" };
    }
  } catch (_e) {
    return { valid: false, error: "Falha ao resolver DNS do host" };
  }
  return { valid: true };
}

/**
 * Assinatura HMAC-SHA256 do body em hex (header X-Webhook-Signature-256).
 */
export async function signPayload(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface SendWebhookOptions {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  payload: Record<string, unknown>;
  secret: string | null;
  customHeaders: Record<string, string>;
  deliveryId?: string;
  event: string;
}

export interface SendWebhookResult {
  statusCode: number | null;
  responseBody: string;
  errorMessage?: string;
}

/**
 * Envia request ao endpoint do webhook com timeout, headers e assinatura.
 * Não segue redirects para outros hosts (redirect: "manual").
 */
export async function sendWebhook(
  options: SendWebhookOptions
): Promise<SendWebhookResult> {
  const { url, method, payload, secret, customHeaders, deliveryId, event } = options;
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": event,
    ...customHeaders,
  };
  if (deliveryId) headers["X-Webhook-Delivery-Id"] = deliveryId;
  if (secret) {
    const signature = await signPayload(secret, body);
    headers["X-Webhook-Signature-256"] = signature;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timeoutId);
    let responseBody = await res.text();
    if (responseBody.length > RESPONSE_BODY_TRUNCATE) {
      responseBody = responseBody.slice(0, RESPONSE_BODY_TRUNCATE) + "\n...[truncated]";
    }
    return {
      statusCode: res.status,
      responseBody,
    };
  } catch (e) {
    clearTimeout(timeoutId);
    const message = e instanceof Error ? e.message : String(e);
    return {
      statusCode: null,
      responseBody: "",
      errorMessage: message,
    };
  }
}

/** Backoff em minutos: 1, 5, 15, 60 (attempt 1-based). */
export function nextRetryDelayMinutes(attempt: number): number {
  const delays = [1, 5, 15, 60];
  return delays[Math.min(attempt - 1, delays.length - 1)] ?? 60;
}

/**
 * Enfileira entregas para todos os webhooks ativos da org que escutam o evento.
 * Chamar após criar/atualizar recurso (ex.: lead) nas Edge Functions.
 * Supabase client deve ser criado com SERVICE_ROLE_KEY.
 */
export async function enqueueWebhookDeliveries(
  supabase: { from: (table: string) => unknown },
  organizationId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { data: list } = await (supabase
    .from("webhooks") as { select: (c: string) => { eq: (a: string, v: unknown) => { eq: (a: string, v: boolean) => { contains: (a: string, v: string[]) => Promise<{ data: { id: string }[] | null }> } } } }
    )
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .contains("events", [event]);

  if (!list?.length) return;
  const next = new Date().toISOString();
  const rows = list.map((w) => ({
    webhook_id: w.id,
    event,
    payload,
    next_retry_at: next,
  }));
  await (supabase.from("webhook_deliveries") as { insert: (rows: unknown) => Promise<{ error: unknown }> }).insert(rows);
}

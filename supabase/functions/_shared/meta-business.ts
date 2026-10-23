/** Isolated Login for Business configuration. Never falls back to legacy secrets. */
export interface MetaBusinessConfig {
  appId: string;
  secret: string;
  configId: string;
  redirectUri: string;
}
export function metaBusinessConfig(): MetaBusinessConfig {
  const appId = Deno.env.get("META_CRM_APP_ID") ?? "";
  const secret = Deno.env.get("META_CRM_APP_SECRET") ?? "";
  const configId = Deno.env.get("META_CRM_CONFIG_ID") ?? "";
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(Deno.env.get("META_CRM_ENCRYPTION_KEY_V1") ?? "")) throw new Error("meta_encryption_not_configured");
  if (!/^\d+$/.test(appId) || !secret || !/^\d+$/.test(configId) || !base.startsWith("https://")) throw new Error("meta_crm_not_configured");
  return { appId, secret, configId, redirectUri: `${base}/functions/v1/meta-oauth-callback` };
}
export function businessLoginUrl(config: MetaBusinessConfig, state: string, authType?: "rerequest"): string {
  return `https://www.facebook.com/v26.0/dialog/oauth?${new URLSearchParams({ client_id: config.appId, config_id: config.configId, redirect_uri: config.redirectUri, response_type: "code", override_default_response_type: "true", state, ...(authType ? { auth_type: authType } : {}) })}`;
}
export async function appSecretProof(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}
export interface TokenInspection { app_id: string; user_id: string; type: string; is_valid: boolean; expires_at: number; data_access_expires_at?: number; scopes?: string[] }
export function validateBusinessToken(data: TokenInspection, appId: string, now = Date.now()): { subjectId: string; expiresAt: string | null } {
  if (!data || !data.is_valid || data.app_id !== appId || data.type !== "SYSTEM_USER" || !/^\d+$/.test(data.user_id)) throw new Error("invalid_business_token");
  if (!Number.isSafeInteger(data.expires_at) || data.expires_at < 0) throw new Error("invalid_token_expiry");
  const expirations = [data.expires_at, data.data_access_expires_at ?? 0];
  if (expirations.some((expiry) => !Number.isSafeInteger(expiry) || expiry < 0 || (expiry > 0 && expiry * 1000 <= now))) throw new Error("expired_business_token");
  const finite = expirations.filter((expiry) => expiry > 0);
  return { subjectId: data.user_id, expiresAt: finite.length ? new Date(Math.min(...finite) * 1000).toISOString() : null };
}
export async function exchangeBusinessCode(code: string, config: MetaBusinessConfig) {
  const response = await fetch("https://graph.facebook.com/v26.0/oauth/access_token", {
    method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.appId, client_secret: config.secret, redirect_uri: config.redirectUri, code }), signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json();
  if (!response.ok || data.error || typeof data.access_token !== "string" || !data.access_token) throw new Error("meta_code_exchange_failed");
  return data.access_token as string;
}
export async function inspectBusinessToken(token: string, config: MetaBusinessConfig): Promise<TokenInspection> {
  const url = new URL("https://graph.facebook.com/v26.0/debug_token");
  url.searchParams.set("input_token", token);
  url.searchParams.set("appsecret_proof", await appSecretProof(`${config.appId}|${config.secret}`, config.secret));
  const response = await fetch(url, { redirect: "error", headers: { Authorization: `Bearer ${config.appId}|${config.secret}` }, signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error("meta_token_inspection_failed");
  validateBusinessToken(body.data, config.appId);
  return body.data;
}

/** An explicit app binding is mandatory; unknown app IDs must never use a different secret. */
export function metaSecretForApp(appId: string | null): string {
  const secret = appId === null
    ? Deno.env.get("META_APP_SECRET")
    : appId === Deno.env.get("META_CRM_APP_ID") ? Deno.env.get("META_CRM_APP_SECRET") : undefined;
  if (!secret) throw new Error("meta_app_credentials_missing");
  return secret;
}

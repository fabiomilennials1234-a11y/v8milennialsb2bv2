/**
 * meta-oauth-state — HMAC-signed OAuth `state` for the Meta connection flow.
 *
 * SECURITY (hotfix): the previous flow encoded `{userId, orgId, connectionType}`
 * as plain base64 in the OAuth `state` and the public `meta-oauth-callback`
 * trusted it before writing meta_connections/meta_pages via service_role. A
 * crafted `state` with a victim's `orgId` was a tenant-binding forgery.
 *
 * Now `state` is minted server-side by `meta-oauth-start` (which derives/validates
 * `orgId` from the caller's membership) and HMAC-signed with META_APP_SECRET, then
 * verified here on the way back. Uses Web Crypto only — runs in Deno and Node/Vitest.
 *
 * Format: `base64url(JSON(payload)) + "." + base64url(HMAC_SHA256(payloadB64))`.
 */

export interface MetaStatePayload {
  userId: string;
  orgId: string;
  connectionType?: string;
  /** Single-use anti-replay nonce. */
  nonce?: string;
  /** Expiry in epoch milliseconds. */
  exp: number;
  [k: string]: unknown;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlFromString(s: string): string {
  return b64urlFromBytes(enc.encode(s));
}

function stringFromB64url(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

/** Constant-time string comparison (length is not secret here). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Mint a signed, tamper-proof OAuth `state`. */
export async function signMetaState(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error("signMetaState: missing secret");
  const payloadB64 = b64urlFromString(JSON.stringify(payload));
  const sig = b64urlFromBytes(await hmacSha256(secret, payloadB64));
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a signed OAuth `state`. Returns the payload, or null if the signature
 * is invalid, the secret is wrong, the token is malformed, or it has expired.
 * Never throws.
 */
export async function verifyMetaState(
  token: string,
  secret: string,
  opts?: { now?: number },
): Promise<MetaStatePayload | null> {
  try {
    if (!token || typeof token !== "string" || !secret) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payloadB64, sig] = parts;
    if (!payloadB64 || !sig) return null;

    const expected = b64urlFromBytes(await hmacSha256(secret, payloadB64));
    if (!timingSafeEqual(sig, expected)) return null;

    const payload = JSON.parse(stringFromB64url(payloadB64)) as MetaStatePayload;
    const now = opts?.now ?? Date.now();
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (!payload.userId || !payload.orgId) return null;
    return payload;
  } catch {
    return null;
  }
}

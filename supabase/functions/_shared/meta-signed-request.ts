/** Meta signs the encoded payload, not the decoded JSON. Never trust user_id before verification. */
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_base64url");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), c => c.charCodeAt(0));
}

export async function verifyMetaSignedRequest(signedRequest: string, secret: string): Promise<string | null> {
  try {
    if (!secret || signedRequest.length > 16_384) return null;
    const parts = signedRequest.split(".");
    if (parts.length !== 2) return null;
    const signature = decode(parts[0]);
    if (signature.length !== 32) return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(parts[1]))) return null;
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decode(parts[1])));
    if (payload.algorithm !== "HMAC-SHA256" || typeof payload.user_id !== "string" || !/^[0-9]{1,64}$/.test(payload.user_id)) return null;
    return payload.user_id;
  } catch {
    return null;
  }
}

/** Opaque receipt per signed event makes retries idempotent without suppressing future requests. */
export async function metaPrivacyReceipt(secret: string, appId: string, userId: string, kind: string, request: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(["meta-privacy-v1", appId, userId, kind, request])));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

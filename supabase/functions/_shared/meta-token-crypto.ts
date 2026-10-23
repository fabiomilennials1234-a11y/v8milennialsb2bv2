/** AES-256-GCM envelopes for the new app; associated data binds tenant, app and asset. */
export interface MetaTokenBinding { appId: string; organizationId: string; asset: string }
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
async function key() {
  const hex = Deno.env.get("META_CRM_ENCRYPTION_KEY_V1") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(hex)) throw new Error("meta_encryption_not_configured");
  return crypto.subtle.importKey("raw", Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
const aad = (binding: MetaTokenBinding) => new TextEncoder().encode(JSON.stringify([binding.appId, binding.organizationId.toLowerCase(), binding.asset]));
export async function encryptMetaToken(token: string, binding: MetaTokenBinding): Promise<string> {
  if (!token || token.length > 16_384) throw new Error("invalid_meta_token");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(binding) }, await key(), new TextEncoder().encode(token));
  return `crm1.${encode(nonce)}.${encode(new Uint8Array(cipher))}`;
}
export async function decryptMetaToken(envelope: string, binding: MetaTokenBinding): Promise<string> {
  try {
    if (typeof envelope !== "string" || envelope.length > 24_000 || !/^crm1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/.test(envelope)) throw new Error();
    const [, nonce, cipher] = envelope.split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(nonce), additionalData: aad(binding) }, await key(), decode(cipher));
    return new TextDecoder().decode(plain);
  } catch { throw new Error("meta_token_decryption_failed"); }
}
export async function storedMetaToken(token: string, appId: string | null, organizationId: string, asset: string): Promise<string> {
  return appId === null ? token : decryptMetaToken(token, { appId, organizationId, asset });
}

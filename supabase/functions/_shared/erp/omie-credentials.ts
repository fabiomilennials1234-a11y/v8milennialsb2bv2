/**
 * Omie credential vault access — the ONLY module that touches
 * omie_connection_secrets. Encrypts with _shared/crypto.ts (AES-256-GCM,
 * key from env OMIE_ENCRYPTION_KEY) and reads/writes via a service_role client,
 * because the table is deny-all (ADR-0020, migration 20270203000000).
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptSecret, decryptSecret } from "../crypto.ts";

export const OMIE_ENCRYPTION_KEY_HEX = Deno.env.get("OMIE_ENCRYPTION_KEY") ?? "";
export const OMIE_ENCRYPTION_KEY_ID = "v1";

export interface OmieCredentials {
  appKey: string;
  appSecret: string;
}

/** Encrypt and persist an org's Omie credentials against its connection row. */
export async function storeOmieCredentials(
  admin: SupabaseClient,
  params: { connectionId: string; organizationId: string; appKey: string; appSecret: string },
): Promise<void> {
  if (!OMIE_ENCRYPTION_KEY_HEX) {
    throw new Error("OMIE_ENCRYPTION_KEY não configurada");
  }
  const key = await encryptSecret(params.appKey, OMIE_ENCRYPTION_KEY_HEX);
  const secret = await encryptSecret(params.appSecret, OMIE_ENCRYPTION_KEY_HEX);

  const { error } = await admin.from("omie_connection_secrets").upsert(
    {
      connection_id: params.connectionId,
      organization_id: params.organizationId,
      app_key_ciphertext: key.ciphertext,
      app_key_nonce: key.nonce,
      app_secret_ciphertext: secret.ciphertext,
      app_secret_nonce: secret.nonce,
      encryption_key_id: OMIE_ENCRYPTION_KEY_ID,
    },
    { onConflict: "connection_id" },
  );
  if (error) throw new Error(`Falha ao salvar credenciais Omie: ${error.message}`);
}

/**
 * Load and decrypt an org's connected Omie credentials, or null if the org has
 * no connected Omie or decryption fails.
 */
export async function loadOmieCredentials(
  admin: SupabaseClient,
  organizationId: string,
): Promise<(OmieCredentials & { connectionId: string }) | null> {
  const { data: conn, error: connErr } = await admin
    .from("omie_connections")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .maybeSingle();
  if (connErr || !conn) return null;

  const { data: sec, error: secErr } = await admin
    .from("omie_connection_secrets")
    .select("app_key_ciphertext, app_key_nonce, app_secret_ciphertext, app_secret_nonce")
    .eq("connection_id", conn.id)
    .maybeSingle();
  if (secErr || !sec) return null;

  try {
    const appKey = await decryptSecret(
      sec.app_key_ciphertext,
      sec.app_key_nonce,
      OMIE_ENCRYPTION_KEY_HEX,
    );
    const appSecret = await decryptSecret(
      sec.app_secret_ciphertext,
      sec.app_secret_nonce,
      OMIE_ENCRYPTION_KEY_HEX,
    );
    return { appKey, appSecret, connectionId: conn.id };
  } catch {
    return null;
  }
}

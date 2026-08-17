/**
 * Cofre de credenciais do Toth — único módulo que toca `toth_connection_secrets`.
 *
 * Espelha `omie-credentials.ts`: cifra AES-256-GCM em `_shared/erp/crypto.ts`,
 * tabela deny-all, acesso só por `service_role`. O que difere: o par guardado é
 * usuário + senha (o Toth não tem chave de aplicação), e a `base_url` vive na
 * tabela de conexão, não no cofre — ela não é segredo, é configuração que a UI
 * precisa exibir para o admin conferir o endereço.
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encryptSecret, decryptSecret } from "./crypto.ts";
import type { TothTokenTransport } from "./toth-client.ts";

export const TOTH_ENCRYPTION_KEY_HEX = Deno.env.get("TOTH_ENCRYPTION_KEY") ?? "";
export const TOTH_ENCRYPTION_KEY_ID = "v1";

export interface TothStoredCredentials {
  connectionId: string;
  baseUrl: string;
  user: string;
  password: string;
  tokenTransport: TothTokenTransport;
}

/** Cifra e persiste usuário + senha do Toth contra a conexão da org. */
export async function storeTothCredentials(
  admin: SupabaseClient,
  params: { connectionId: string; organizationId: string; user: string; password: string },
): Promise<void> {
  if (!TOTH_ENCRYPTION_KEY_HEX) {
    throw new Error("TOTH_ENCRYPTION_KEY não configurada");
  }
  const user = await encryptSecret(params.user, TOTH_ENCRYPTION_KEY_HEX);
  const password = await encryptSecret(params.password, TOTH_ENCRYPTION_KEY_HEX);

  const { error } = await admin.from("toth_connection_secrets").upsert(
    {
      connection_id: params.connectionId,
      organization_id: params.organizationId,
      user_ciphertext: user.ciphertext,
      user_nonce: user.nonce,
      password_ciphertext: password.ciphertext,
      password_nonce: password.nonce,
      encryption_key_id: TOTH_ENCRYPTION_KEY_ID,
    },
    { onConflict: "connection_id" },
  );
  if (error) throw new Error(`Falha ao salvar credenciais do Toth: ${error.message}`);
}

/**
 * Carrega e decifra as credenciais do Toth conectado da org, ou `null` quando
 * não há conexão ativa ou a decifra falha (chave rotacionada sem re-conectar).
 */
export async function loadTothCredentials(
  admin: SupabaseClient,
  organizationId: string,
): Promise<TothStoredCredentials | null> {
  const { data: conn, error: connErr } = await admin
    .from("toth_connections")
    .select("id, base_url, token_transport")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .maybeSingle();
  if (connErr || !conn) return null;

  const { data: sec, error: secErr } = await admin
    .from("toth_connection_secrets")
    .select("user_ciphertext, user_nonce, password_ciphertext, password_nonce")
    .eq("connection_id", conn.id)
    .maybeSingle();
  if (secErr || !sec) return null;

  try {
    const user = await decryptSecret(sec.user_ciphertext, sec.user_nonce, TOTH_ENCRYPTION_KEY_HEX);
    const password = await decryptSecret(
      sec.password_ciphertext,
      sec.password_nonce,
      TOTH_ENCRYPTION_KEY_HEX,
    );
    return {
      connectionId: conn.id as string,
      baseUrl: conn.base_url as string,
      user,
      password,
      tokenTransport: (conn.token_transport as TothTokenTransport) ?? "query",
    };
  } catch {
    return null;
  }
}

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
// `../crypto.ts`, não `./crypto.ts`: nesta base o módulo de cifra mora em
// `_shared/crypto.ts` — é de onde `omie-credentials.ts` também o importa. Em
// `develop` ele foi movido para `_shared/erp/crypto.ts`; quando as duas linhas
// se encontrarem, este import muda junto. Mesma API dos dois lados.
import { encryptSecret, decryptSecret } from "../crypto.ts";
import type { TothTokenTransport } from "./toth-client.ts";
import type { BaseUrlPolicy } from "./toth-url.ts";

export const TOTH_ENCRYPTION_KEY_HEX = Deno.env.get("TOTH_ENCRYPTION_KEY") ?? "";
export const TOTH_ENCRYPTION_KEY_ID = "v1";

/**
 * Monta a política de URL a partir do aceite gravado na conexão.
 *
 * A permissão de `http://` vem do **banco** (decisão por organização, com aceite
 * do admin); a de host privado vem do **ambiente**, e só existe em máquina de
 * desenvolvimento. As duas nunca se misturam: uma org que aceitou tráfego em
 * claro não ganha, de brinde, o direito de apontar a integração para a rede
 * interna do provedor.
 */
export function tothUrlPolicy(conn: { allowInsecureTransport?: boolean }): BaseUrlPolicy {
  return {
    allowHttp: conn.allowInsecureTransport === true,
    allowPrivateHosts: Deno.env.get("TOTH_ALLOW_PRIVATE_HOSTS") === "1",
  };
}

export interface TothStoredCredentials {
  connectionId: string;
  baseUrl: string;
  user: string;
  password: string;
  tokenTransport: TothTokenTransport;
  /** Aceite explícito de http:// gravado na conexão pelo admin. */
  allowInsecureTransport: boolean;
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

// ─────────────────────────────────────────────────────────────────────────────
// Serviço Flow (pedidos) — MESMO ERP, outro servidor, outra credencial
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O par do Flow é `client_id` + `client_secret`, e não o `user`/`password` do
 * `/toth/services`. Guardar no mesmo cofre é decisão de custo: a tabela já é
 * deny-all, já está atrelada à conexão e já tem trigger de `updated_at` —
 * duplicar tudo isso para o segundo serviço do mesmo ERP não compraria
 * isolamento nenhum.
 *
 * O que NÃO se reaproveita é o valor: mesmo que o fornecedor entregue as
 * mesmas letras nos dois serviços, são credenciais de sistemas distintos e
 * rotacionam separado. Coluna própria, sempre.
 */
export interface TothFlowStoredCredentials {
  connectionId: string;
  /** Base do serviço Flow — `toth_connections.flow_base_url`. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  allowInsecureTransport: boolean;
}

export async function storeTothFlowCredentials(
  admin: SupabaseClient,
  params: {
    connectionId: string;
    organizationId: string;
    clientId: string;
    clientSecret: string;
  },
): Promise<void> {
  if (!TOTH_ENCRYPTION_KEY_HEX) {
    throw new Error("TOTH_ENCRYPTION_KEY não configurada");
  }
  const id = await encryptSecret(params.clientId, TOTH_ENCRYPTION_KEY_HEX);
  const secret = await encryptSecret(params.clientSecret, TOTH_ENCRYPTION_KEY_HEX);

  // `update`, não `upsert`: a linha de segredo já existe (o Toth conectou
  // antes), e um upsert sem `user_ciphertext` esbarraria no NOT NULL da coluna
  // do outro serviço. Conectar o Flow não pode exigir redigitar a senha do Toth.
  const { data, error } = await admin
    .from("toth_connection_secrets")
    .update({
      flow_client_id_ciphertext: id.ciphertext,
      flow_client_id_nonce: id.nonce,
      flow_client_secret_ciphertext: secret.ciphertext,
      flow_client_secret_nonce: secret.nonce,
    })
    .eq("connection_id", params.connectionId)
    .eq("organization_id", params.organizationId)
    // `.select()` não é enfeite: um UPDATE que não casa linha nenhuma devolve
    // `error: null`. Sem conferir, a conexão gravaria `flow_base_url`, a tela
    // diria "pedidos configurados" e a sincronização falharia com
    // "credenciais indisponíveis" — sem ninguém saber que a gravação nunca
    // aconteceu. Silêncio é o modo de falha que este cofre não pode ter.
    .select("connection_id");
  if (error) throw new Error(`Falha ao salvar credenciais do serviço de pedidos: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      "Não há linha de segredo para esta conexão — grave o usuário/senha do Toth antes das credenciais do serviço de pedidos.",
    );
  }
}

/**
 * Carrega as credenciais do Flow, ou `null` quando a org não tem o serviço
 * configurado.
 *
 * `null` aqui é o estado NORMAL, não uma falha: das orgs com Toth, só a Café
 * Jurerê tem o serviço de pedidos publicado. Quem chama distingue "não
 * configurado" de "erro" pela mensagem, não por este retorno.
 */
export async function loadTothFlowCredentials(
  admin: SupabaseClient,
  organizationId: string,
): Promise<TothFlowStoredCredentials | null> {
  const { data: conn, error: connErr } = await admin
    .from("toth_connections")
    .select("id, flow_base_url, allow_insecure_transport")
    .eq("organization_id", organizationId)
    .eq("status", "connected")
    .maybeSingle();
  if (connErr || !conn || !conn.flow_base_url) return null;

  const { data: sec, error: secErr } = await admin
    .from("toth_connection_secrets")
    // Literal única: concatenar alarga o tipo para `string` e o supabase-js
    // devolve `GenericStringError` em vez da linha tipada.
    .select("flow_client_id_ciphertext, flow_client_id_nonce, flow_client_secret_ciphertext, flow_client_secret_nonce")
    .eq("connection_id", conn.id)
    .maybeSingle();
  if (secErr || !sec || !sec.flow_client_id_ciphertext || !sec.flow_client_secret_ciphertext) {
    return null;
  }

  try {
    const clientId = await decryptSecret(
      sec.flow_client_id_ciphertext,
      sec.flow_client_id_nonce,
      TOTH_ENCRYPTION_KEY_HEX,
    );
    const clientSecret = await decryptSecret(
      sec.flow_client_secret_ciphertext,
      sec.flow_client_secret_nonce,
      TOTH_ENCRYPTION_KEY_HEX,
    );
    return {
      connectionId: conn.id as string,
      baseUrl: conn.flow_base_url as string,
      clientId,
      clientSecret,
      allowInsecureTransport: conn.allow_insecure_transport === true,
    };
  } catch {
    return null;
  }
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
    .select("id, base_url, token_transport, allow_insecure_transport")
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
      allowInsecureTransport: conn.allow_insecure_transport === true,
    };
  } catch {
    return null;
  }
}

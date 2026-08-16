/**
 * Tipos compartilhados entre os hooks de chat.
 * Extraídos de src/hooks/useWhatsAppChat.ts (C12).
 *
 * Barrel useWhatsAppChat.ts re-exporta todos estes tipos para backwards-compat.
 */

export interface WhatsAppMessage {
  id: string;
  organization_id: string;
  instance_id: string | null;
  message_id: string;
  remote_jid: string;
  phone_number: string;
  direction: "incoming" | "outgoing";
  message_type: string;
  content: string | null;
  media_url: string | null;
  /** True when media was purged by the 30-day retention job. Renders "expired" state. */
  media_expired?: boolean | null;
  push_name: string | null;
  status: string;
  lead_id: string | null;
  timestamp: string;
  created_at: string;
  /** Whether this message was sent by the Copilot AI agent */
  sent_by_ai: boolean | null;
  sent_source: "manual" | "copilot" | "workflow" | null;
}

/** Mensagem que falhou ao ser enviada — armazenada em cache paralelo para retry. */
export interface FailedMessage {
  id: string;
  phoneNumber: string;
  instanceId: string | null;
  instanceName: string;
  message: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  error: string;
  timestamp: string;
  direction: "outgoing";
  status: "failed";
  sent_by_ai: false;
}

export interface ChatContactTag {
  id: string;
  name: string;
  color: string;
}

export interface ChatContact {
  /**
   * Discriminador da união `InboxContact`. Literal e OBRIGATÓRIO de propósito:
   * é o compilador que aponta todo sítio de CONSTRUÇÃO de contato quando um
   * segundo canal entra no inbox. Opcional (ou com default) o campo faria os
   * mesmos sítios compilarem calados e produzirem contatos sem canal, que a
   * lista renderizaria com o selo errado. Nenhum sítio de LEITURA quebra: quem
   * já tinha `ChatContact` continua tendo.
   */
  channel: "whatsapp";
  phone_number: string;
  push_name: string | null;
  last_message: string | null;
  last_message_time: string;
  /** Direção da última mensagem: incoming = lead enviou, outgoing = você enviou */
  last_message_direction: "incoming" | "outgoing" | null;
  last_message_sent_source: "manual" | "copilot" | "workflow" | null;
  unread_count: number;
  lead_id: string | null;
  lead_name: string | null;
  /** ID do registro em whatsapp_conversations (null se nunca teve ação) */
  conversation_id: string | null;
  /** Se a conversa está arquivada */
  archived_at: string | null;
  /** Tags combinadas: lead_tags + conversation_tags (sem duplicatas) */
  tags: ChatContactTag[];
  /** True quando o "contato" representa um grupo do WhatsApp (remote_jid @g.us). */
  is_group: boolean;
  /**
   * Funis em que o lead está + etapa atual em cada um. Enriquecido pela camada de
   * dados (useLeadInboxMeta) a partir de pipeline_entries. Lead pode estar em
   * vários funis ao mesmo tempo. **Opcional**: só o inbox principal (/chat)
   * enriquece — outros consumidores (bubble, meta) deixam undefined, e o engine
   * trata como "sem funil".
   */
  funnels?: { pipelineId: string; stageKey: string }[];
  /** qualification_tier do lead (diamante/ouro/prata/bronze/desqualificado). Opcional — ver funnels. */
  qualification_tier?: string | null;
}

/** Instância de WhatsApp que o usuário pode acessar (para seletor de inbox) */
export interface WhatsAppInstanceForUser {
  id: string;
  instance_name: string;
  status: string;
  /** Provider — drives capability gating (Uazapi/Evolution/Meta Cloud). Rule 13. */
  provider?: string;
}

// ─── Canais sociais (Instagram via NotificaMe) ───────────────────────────────

/**
 * Conversa de um canal SOCIAL (hoje só Instagram Direct).
 *
 * Tipo IRMÃO de `ChatContact`, não uma flexibilização dele. O motivo é o
 * `phone_number`: em `ChatContact` ele é `string` obrigatório e é a IDENTIDADE
 * da conversa — 18 referências só na bolha de chat contam com isso. Um contato
 * de Instagram não tem telefone, e afrouxar o campo para `string | null` faria
 * cada um desses sítios ter de decidir o que fazer com o nulo. Pior: preencher
 * com `''` colapsaria TODOS os contatos de IG numa conversa só, porque
 * `normalizePhone('')` devolve `''` e a chave vira a mesma para todo mundo.
 *
 * A identidade aqui é `(messaging_channel_id, external_user_id)`, materializada
 * em `conversation_key` — a MESMA string que vai para
 * `conversation_read_state.conversation_key`, prefixada por `instagram:` desde o
 * dia zero para nunca colidir com o recorte `whatsapp:%` da RPC de WhatsApp.
 */
export interface SocialContact {
  channel: "instagram";
  /** `instagram:${messaging_channel_id}:${external_user_id}` — chave de leitura e de cache. */
  conversation_key: string;
  messaging_channel_id: string;
  /** IGSID do INTERLOCUTOR (nunca da nossa conta). */
  external_user_id: string;
  /** @handle do interlocutor, quando o payload informa. */
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  last_message: string | null;
  last_message_time: string;
  last_message_direction: "incoming" | "outgoing" | null;
  unread_count: number;
  /**
   * Lead vinculado a esta identidade de Instagram, quando alguém vinculou.
   *
   * A fonte da verdade é `lead_social_identities` — NÃO
   * `channel_messages.lead_id`, que é cache derivado e nasce nulo em toda
   * mensagem que chega antes do vínculo existir. Quem preenche este campo é o
   * LEFT JOIN da RPC da lista; o vínculo em si só é criado por humano
   * autenticado no chat (o webhook de entrada não é assinado e por isso não
   * cria nada).
   */
  lead_id: string | null;
  /**
   * Nome do lead vinculado. Vem JUNTO na RPC, não de um segundo fetch: a lista
   * do WhatsApp paga um fanout de enriquecimento por lote e é ele que produz a
   * janela em que a linha aparece sem nome.
   */
  lead_name: string | null;
  /** Sempre `[]` nesta fatia: etiqueta hoje pendura em lead ou em conversa de WhatsApp. */
  tags: ChatContactTag[];
}

/** Uma conversa do inbox, de qualquer canal. Discriminada por `channel`. */
export type InboxContact = ChatContact | SocialContact;

/**
 * Uma CAIXA DE ENTRADA. O seletor do inbox deixou de ser "lista de números de
 * WhatsApp" e passou a ser esta união: `whatsapp_instances` ∪
 * `messaging_channels`. Org sem canal social não tem linha na segunda metade e
 * a união degrada, byte a byte, para o comportamento de hoje — por isso não há
 * feature flag plumbada no front.
 */
export type InboxBox =
  | { kind: "whatsapp"; id: string; name: string; status: string; provider?: string }
  | { kind: "instagram"; id: string; name: string; status: string; handle: string | null };

/** True quando o contato é de WhatsApp — narrowing para os caminhos legados. */
export function isWhatsAppContact(c: InboxContact): c is ChatContact {
  return c.channel === "whatsapp";
}

/** True quando o contato é de um canal social. */
export function isSocialContact(c: InboxContact): c is SocialContact {
  return c.channel === "instagram";
}

/**
 * Identidade da conversa, num lugar só.
 *
 * É o que o shell guarda em `selectedKey`, o que vira `key` de cada linha da
 * lista e o que compara seleção. Um helper e não dois campos porque a alternativa
 * — cada call-site escolher entre `phone_number` e `conversation_key` — é como o
 * `chat-meta` casou thread por `sender_id` e fez toda mensagem de SAÍDA sumir.
 */
export function contactKey(c: InboxContact): string {
  return c.channel === "whatsapp" ? c.phone_number : c.conversation_key;
}

/**
 * Nome exibido da conversa.
 *
 * Para Instagram o `@handle` ganha do nome de exibição porque é o que o usuário
 * vê no app do Instagram; sem nenhum dos dois, o sufixo do IGSID é preferível a
 * um rótulo genérico — dois contatos sem nome precisam continuar distinguíveis
 * na lista.
 */
export function contactLabel(c: InboxContact): string {
  if (c.channel === "whatsapp") {
    return (c.push_name || c.lead_name || c.phone_number || "").trim() || "Contato";
  }
  if (c.handle) return `@${c.handle}`;
  if (c.display_name) return c.display_name;
  return `Instagram ${c.external_user_id.slice(-6)}`;
}

/** Semente estável do gradiente do avatar — nunca string vazia. */
export function contactAvatarSeed(c: InboxContact): string {
  return c.channel === "whatsapp"
    ? c.phone_number || contactLabel(c)
    : c.external_user_id || c.conversation_key;
}

/** Monta a `conversation_key` de um contato social. Único produtor da string. */
export function buildSocialConversationKey(
  messagingChannelId: string,
  externalUserId: string,
): string {
  return `instagram:${messagingChannelId}:${externalUserId}`;
}

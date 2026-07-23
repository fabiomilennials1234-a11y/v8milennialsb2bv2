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

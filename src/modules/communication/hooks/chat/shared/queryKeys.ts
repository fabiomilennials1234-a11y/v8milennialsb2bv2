/**
 * chatQueryKeys — fábrica única de queryKeys do domínio Chat WhatsApp.
 *
 * Motivação: antes desta fábrica, queryKeys eram compostas inline em cada
 * call-site. Qualquer divergência (ex: omitir `instanceId`) rompia o match
 * entre cache e patches de realtime, gerando "mensagem não aparece" no
 * drawer Lead. A fábrica garante consistência entre cache, mutations e
 * realtime subscribers.
 *
 * Regras:
 * - Sempre incluir `organizationId` na key (multi-tenant — invalida cache
 *   ao trocar de org).
 * - Sempre tipar como readonly tuple (TanStack Query exige imutabilidade
 *   estrutural pra cache key resolution).
 * - NÃO incluir flags de UI (filtros locais, sort) — essas são concerns de
 *   `select` ou de queries derivadas. Exceção: filtro que o SERVIDOR aplica
 *   (issue #1277) muda o resultado da query, então faz parte da identidade dela
 *   e entra na key. Filtro que só o cliente aplica continua fora.
 */
export const chatQueryKeys = {
  /** Mensagens de uma conversa específica em uma instância. */
  messages: (
    organizationId: string | null | undefined,
    phoneNumber: string | null | undefined,
    instanceId: string | null | undefined,
  ) =>
    [
      "whatsapp_messages",
      organizationId ?? null,
      phoneNumber ?? null,
      instanceId ?? null,
    ] as const,

  /**
   * Prefixo da lista de contatos, sem o recorte de filtro. É por aqui que
   * patches de realtime e invalidações alcançam TODAS as variantes filtradas da
   * mesma instância — use com `setQueriesData`/`invalidateQueries`, nunca com
   * `setQueryData` (que exige key exata e erraria toda variante).
   */
  contactsPrefix: (
    organizationId: string | null | undefined,
    instanceId: string | null | undefined,
  ) =>
    [
      "whatsapp_contacts",
      organizationId ?? null,
      instanceId ?? null,
    ] as const,

  /**
   * Lista de contatos (sidebar) de uma instância.
   *
   * `filterKey` identifica o recorte que a RPC aplicou server-side (issue
   * #1277) — sem ele, duas listas com filtros diferentes colidiriam no cache.
   * `""` é a lista sem filtro, compartilhada com command palette e bolha.
   */
  contacts: (
    organizationId: string | null | undefined,
    instanceId: string | null | undefined,
    filterKey?: string,
  ) =>
    [
      "whatsapp_contacts",
      organizationId ?? null,
      instanceId ?? null,
      filterKey ?? "",
    ] as const,

  /** Contagem lightweight de unread para badge global (ChatBubbleContext). */
  unreadBadge: (
    organizationId: string | null | undefined,
    instanceId: string | null | undefined,
  ) =>
    [
      "whatsapp_unread_badge",
      organizationId ?? null,
      instanceId ?? null,
    ] as const,

  /**
   * Resolução de instância para um lead a partir do telefone normalizado.
   * Substitui o queryKey ad-hoc `["lead-whatsapp-instance", phone]` que
   * existia no EmbeddedChatWindow antes da unificação.
   */
  leadWhatsAppInstance: (phoneNormalized: string | null | undefined) =>
    ["lead-whatsapp-instance", phoneNormalized ?? null] as const,

  /** Resolver de deep-link `?phone=&instance=` no /chat moderno. */
  chatDeepLink: (
    organizationId: string | null | undefined,
    phoneNormalized: string | null | undefined,
    allowedInstanceIdsCsv: string,
  ) =>
    [
      "chat-deep-link",
      organizationId ?? null,
      phoneNormalized ?? null,
      allowedInstanceIdsCsv,
    ] as const,

  /**
   * Ligações que pertencem a uma conversa.
   *
   * A identidade é `(org, telefone normalizado, lead)` — as MESMAS duas
   * identidades que `fetchConversationCalls` usa no filtro. O telefone entra
   * já normalizado (e não cru como em `messages`) porque dois formatos do
   * mesmo número produzem exatamente a mesma linha de ligação: mantê-los
   * separados no cache seria um segundo fetch para a mesma resposta.
   */
  calls: (
    organizationId: string | null | undefined,
    phoneNormalized: string | null | undefined,
    leadId: string | null | undefined,
  ) =>
    [
      "call_logs_conversation",
      organizationId ?? null,
      phoneNormalized ?? null,
      leadId ?? null,
    ] as const,

  /**
   * Lista de conversas de um canal SOCIAL (Instagram).
   *
   * Namespace NOVO — jamais reaproveitar `whatsapp_contacts`. O patcher de
   * realtime de WhatsApp (`useWhatsAppMessagesRealtime`) alcança o cache por
   * PREFIXO com `setQueriesData`; se as duas listas dividissem o primeiro
   * segmento da chave, ele escreveria `ChatContact[]` por cima de linhas de
   * Instagram e a lista mudaria de tipo em tempo de execução.
   */
  socialContacts: (
    organizationId: string | null | undefined,
    messagingChannelId: string | null | undefined,
  ) =>
    [
      "social_contacts",
      organizationId ?? null,
      messagingChannelId ?? null,
    ] as const,

  /** Mensagens de uma conversa social, por (canal, interlocutor). */
  socialMessages: (
    organizationId: string | null | undefined,
    messagingChannelId: string | null | undefined,
    contactExternalId: string | null | undefined,
  ) =>
    [
      "social_messages",
      organizationId ?? null,
      messagingChannelId ?? null,
      contactExternalId ?? null,
    ] as const,

  /** Mensagens com falha de envio (cache local de retry). */
  failed: (
    organizationId: string | null | undefined,
    phoneNumber: string | null | undefined,
  ) =>
    [
      "whatsapp_failed_messages",
      organizationId ?? null,
      phoneNumber ?? null,
    ] as const,
} as const;

export type ChatQueryKey =
  | ReturnType<typeof chatQueryKeys.messages>
  | ReturnType<typeof chatQueryKeys.contacts>
  | ReturnType<typeof chatQueryKeys.contactsPrefix>
  | ReturnType<typeof chatQueryKeys.unreadBadge>
  | ReturnType<typeof chatQueryKeys.leadWhatsAppInstance>
  | ReturnType<typeof chatQueryKeys.chatDeepLink>
  | ReturnType<typeof chatQueryKeys.failed>
  | ReturnType<typeof chatQueryKeys.calls>
  | ReturnType<typeof chatQueryKeys.socialContacts>
  | ReturnType<typeof chatQueryKeys.socialMessages>;

/**
 * Primeiro segmento das chaves sociais. É o que `useRealtimeSubscription`
 * recebe (ele invalida por `[chave[0]]`), e é o que garante que a invalidação
 * de um canal social nunca toque o cache de WhatsApp.
 */
export const SOCIAL_CONTACTS_KEY_ROOT = "social_contacts" as const;
export const SOCIAL_MESSAGES_KEY_ROOT = "social_messages" as const;

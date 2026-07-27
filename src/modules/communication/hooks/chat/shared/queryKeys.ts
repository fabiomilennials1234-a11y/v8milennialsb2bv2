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
  | ReturnType<typeof chatQueryKeys.failed>;

/**
 * Module communication — API pública.
 *
 * Tudo que outros módulos consomem deve estar exportado aqui.
 * Internals (subpastas, hooks privados, componentes de detalhe) são privados —
 * ESLint `boundaries` impede import direto de fora.
 *
 * Boundary enforcement: warn agora (slice 1), error em slice 17.
 * Pages NÃO são exportadas daqui — App.tsx faz deep-import via
 * `@/modules/communication/pages/X` para preservar code-splitting via React.lazy().
 *
 * Ver `./CLAUDE.md` deste módulo para escopo (WhatsApp Uazapi + Meta + SZ.Chat),
 * entidade primária (Conversation + Message + Instance), e áreas frágeis.
 *
 * 🔴 Área frágil declarada — provider-agnostic adapter no `_shared/` (NÃO migra
 * até slice 16). Edge functions ficam para slice 15. Frontend (este módulo)
 * consome via `whatsappApi` lib + edge functions invocadas via supabase client.
 *
 * Realtime: subscriptions específicas do chat (`useWhatsAppMessagesRealtime`,
 * `useChatBubbleContactsRealtime`) usam `useRealtimeChannel` cross-cutting
 * (continua em `src/hooks/` enquanto não houver `core/realtime/` — slice 14).
 */

// ── WhatsApp — provider-aware connections (Uazapi / Meta Cloud) ───────────
export { WhatsAppProviderChooser } from "./components/whatsapp/WhatsAppProviderChooser";
// Meta WhatsApp Cloud CONNECTION via Embedded Signup (Slice 3, ADR-0009).
// INERT until Meta App Review + VITE_META_WA_CONFIG_ID — graceful fallback toast.
export { useConnectWhatsAppCloud } from "./hooks/useConnectWhatsAppCloud";
export type { UseConnectWhatsAppCloudResult } from "./hooks/useConnectWhatsAppCloud";
export {
  getProviderProfile,
  canUseUazapiActions,
  type WhatsAppProviderId,
  type ProviderProfile,
  type ProviderCapabilities,
} from "./lib/whatsapp-provider";

// ── Hooks: WhatsApp — chat shell barrel (re-exports principais) ───────────
export {
  useWhatsAppInstancesForUser,
  useActiveWhatsAppInstance,
  useWhatsAppContacts,
  useWhatsAppMessages,
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
  useFailedMessages,
  useRetryMessage,
  useWhatsAppMessagesRealtime,
  useTransferToSzChatDepartment,
  useActiveSzChatSession,
  useReactMessage,
  useEditMessage,
  usePinMessage,
  useDeleteMessage,
  useMarkMessageRead,
  isFeatureUnavailable,
  useHistorySyncJobs,
  useCreateHistorySyncJob,
  useControlHistorySyncJob,
  useMassSendJobs,
  useCreateMassSend,
  useControlMassSend,
  useRefreshMassSendStatus,
} from "./hooks/useWhatsAppChat";
export type {
  WhatsAppMessage,
  FailedMessage,
  ChatContact,
  ChatContactTag,
  WhatsAppInstanceForUser,
  HistorySyncJob,
  HistorySyncJobInsert,
  SyncScope,
  UazapiSenderJob,
} from "./hooks/useWhatsAppChat";

// ── Hooks: WhatsApp — instance management (top-level CRUD) ────────────────
export {
  useWhatsAppInstances,
  useWhatsAppInstancesWithAgent,
  useCreateWhatsAppInstance,
  useUpdateWhatsAppInstance,
  useRefreshQRCode,
  useCheckConnectionStatus,
  useDeleteWhatsAppInstance,
  useLogoutInstance,
} from "./hooks/useWhatsAppInstances";
export type {
  WhatsAppInstance,
  WhatsAppInstanceInsert,
  WhatsAppInstanceUpdate,
  DeleteInstanceResult,
} from "./hooks/useWhatsAppInstances";

// NOTE: vários hooks/componentes deste módulo foram refatorados/renomeados, mas o barrel
// continuava re-exportando nomes que não existem mais (useWhatsAppInstanceAllowedMembers,
// useOrgWhatsAppMigration, useWhatsAppFunnel, useWhatsAppLeadIntegration, useMetaConnection).
// Esses re-exports mortos quebravam o ESM em dev (Vite) → tela branca (o build de produção
// os tree-shakava, mascarando o problema). Removidos. Consumidores usam os nomes reais via
// deep-import dos arquivos (ex.: useOrgMigrationStatus, useLeadByPhone, useMetaConnectionStatus).
export { usePreferredInstance } from "./hooks/usePreferredInstance";
export { useUserWriteInstanceFlag } from "./hooks/useUserWriteInstanceFlag";

// ── Hooks: WhatsApp conversations (CRUD/archive/tags/funnel) ──────────────
export {
  useWhatsAppConversationsMeta,
  useWhatsAppConversationTags,
  useArchiveConversation,
  useUnarchiveConversation,
  useDeleteConversation,
  useAddConversationTag,
  useRemoveConversationTag,
} from "./hooks/useWhatsAppConversations";
export type {
  ConversationMeta,
  ConversationTagLink,
} from "./hooks/useWhatsAppConversations";

// ── Hooks: composer state + chat bubble ──────────────────────────────────
export { useConversationDraft } from "./hooks/useConversationDraft";
export { useConversationNotes } from "./hooks/useConversationNotes";
export { useConversationHistory } from "./hooks/useConversationHistory";
export { useChatBubble, useChatBubbleOptional } from "./hooks/useChatBubble";
export { useChatBubbleState } from "./hooks/useChatBubbleState";

// ── Hooks: messaging — actions + templates + limits + scheduling ─────────
export {
  useScheduledMessagesForLead,
  useLeadsWithScheduledMessages,
  useCreateScheduledMessage,
  useCancelScheduledMessage,
  useUpdateScheduledMessage,
  useMyScheduledMessages,
} from "./hooks/useScheduledMessages";
export type { ScheduledMessage } from "./hooks/useScheduledMessages";

export { useDownloadMedia } from "./hooks/useMessageActions";

export { useMessageLimits } from "./hooks/useMessageLimits";
export {
  useMessageTemplates,
  useCreateMessageTemplate,
  useUpdateMessageTemplate,
  useDeleteMessageTemplate,
} from "./hooks/useMessageTemplates";
export type { MessageTemplate, MediaType } from "./hooks/useMessageTemplates";

export { useIncomingMessageToast } from "./hooks/useIncomingMessageToast";

// ── Hooks: Meta (Messenger / Instagram) ───────────────────────────────────
export { useMetaPages } from "./hooks/chat-meta/useMetaPages";
export { useMetaConversations } from "./hooks/chat-meta/useMetaConversations";
export { useMetaConversationProfile } from "./hooks/chat-meta/useMetaConversationProfile";
export { useMetaMessages } from "./hooks/chat-meta/useMetaMessages";
export { useMetaSend } from "./hooks/chat-meta/useMetaSend";
export { useMetaMarkAsRead } from "./hooks/chat-meta/useMetaMarkAsRead";
export { useMetaLinkLead } from "./hooks/chat-meta/useMetaLinkLead";
export { useMetaRealtime } from "./hooks/chat-meta/useMetaRealtime";
export type {
  MetaChannel,
  MetaPage,
  MetaConversation,
  MetaConversationInsert,
  MetaConversationUpdate,
  ChannelMessage,
  MetaConversationWithLead,
  SendMetaMessageInput,
  MetaPagesByChannel,
} from "./hooks/chat-meta/types";

// ── Hooks: Meta WhatsApp Cloud message templates (Slice 6, ADR-0009) ──────
// INERT until the `meta_cloud` feature flag is enabled. Gate UI behind
// useFeatureFlag("meta_cloud").
export {
  useMetaTemplates,
  useCreateMetaTemplate,
  useSyncMetaTemplates,
} from "./hooks/useMetaTemplates";
export type {
  MetaMessageTemplate,
  MetaTemplateStatus,
  MetaTemplateCategory,
  MetaTemplateComponent,
  CreateMetaTemplateInput,
} from "./hooks/useMetaTemplates";

// ── Hooks: sessions, dead-state ───────────────────────────────────────────
export { useDeadSessions } from "./hooks/useDeadSessions";

// ── Components: chat shell + primitives ───────────────────────────────────
export {
  ChatShellWithContext,
  MessageBubble,
  MessagesAreaErrorBoundary,
  AudioPlayer,
  getAudioPlaybackUrl,
  AudioRecorder,
  ImagePreviewModal,
  MessageImage,
  MessageVideo,
  MessageDocument,
  formatMessageTime,
  MessageStatusIcon,
  ChatEmptyState,
  ScrollToBottomFab,
  UnreadDivider,
} from "./components/chat";
export { ChatSkeleton } from "./components/chat/ChatSkeleton";

// ── Components: chat ancillary (banner, modal, schedule) ─────────────────
export { ScheduledMessagesBanner } from "./components/chat/ScheduledMessagesBanner";
export { ScheduleMessageModal } from "./components/chat/ScheduleMessageModal";
export { default as ConversationNotes } from "./components/chat/ConversationNotes";
export { LeadContactModal } from "./components/chat/LeadContactModal";
export { HumanPauseBadge } from "./components/chat/HumanPauseBadge";
export { ChannelBadge } from "./components/chat/ChannelBadge";
export { RealtimeStatusBadge } from "./components/chat/RealtimeStatusBadge";

// ── Components: Meta chat ─────────────────────────────────────────────────
export { MetaChatShell } from "./components/chat-meta/MetaChatShell";
export { MetaChatHeader } from "./components/chat-meta/MetaChatHeader";
export { ChatMetaSkeleton } from "./components/chat-meta/ChatMetaSkeleton";
export { MetaConversationList } from "./components/chat-meta/MetaConversationList";
export { MetaConversationListItem } from "./components/chat-meta/MetaConversationListItem";
export { MetaMessageList } from "./components/chat-meta/MetaMessageList";
export { MetaMessageBubble } from "./components/chat-meta/MetaMessageBubble";
export { MetaComposer } from "./components/chat-meta/MetaComposer";
export { MetaWindowWarning } from "./components/chat-meta/MetaWindowWarning";
export { LinkLeadDialog } from "./components/chat-meta/LinkLeadDialog";

// ── Components: WhatsApp lifecycle (session-dead + migration) ────────────
export { SessionDeadBanner } from "./components/whatsapp/SessionDeadBanner";
export {
  WhatsAppMigrationBanner,
  RepairingWizard,
} from "./components/whatsapp-migration";

// ── Lib: low-level API + helpers ──────────────────────────────────────────
export * as whatsappApi from "./lib/whatsappApi";
export { primaryInstanceFor } from "./lib/primaryInstanceFor";
export type { PrimaryInstanceForArgs } from "./lib/primaryInstanceFor";
export { computeNeedsDeepLinkResolve } from "./lib/computeNeedsDeepLinkResolve";
export {
  prefetchChatRoute,
  prefetchChatData,
} from "./lib/chatPrefetch";
export type { PrefetchChatDataParams } from "./lib/chatPrefetch";

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

// ── WhatsApp — provider-aware connections (Uazapi / Meta Cloud / NotificaMe) ──
export { WhatsAppProviderChooser } from "./components/whatsapp/WhatsAppProviderChooser";
// Meta WhatsApp Cloud CONNECTION via Embedded Signup (Slice 3, ADR-0009).
// INERT until Meta App Review + VITE_META_WA_CONFIG_ID — graceful fallback toast.
export { useConnectWhatsAppCloud } from "./hooks/useConnectWhatsAppCloud";
export type { UseConnectWhatsAppCloudResult } from "./hooks/useConnectWhatsAppCloud";
// NotificaMe Seamless CONNECTION (canal oficial via BSP, fatia 1).
// INERT enquanto faltarem os secrets do fornecedor — NOTIFICAME_API_TOKEN,
// NOTIFICAME_SUBACCOUNT_DEFAULTS e NOTIFICAME_ENCRYPTION_KEY — ou enquanto quem
// olha a tela não for admin/master: `isConfigured=false` + `configReason`
// legível, para o card nascer desabilitado COM motivo.
// (NOTIFICAME_COMPANY_UUID foi eliminado nesta branch: sob subconta por org não
// há um uuid nosso e único; há um por org, e ele é credencial no cofre.)
export { useConnectNotificame } from "./hooks/useConnectNotificame";
export type {
  UseConnectNotificameResult,
  SeamlessChannelType,
} from "./hooks/useConnectNotificame";
// Canais SOCIAIS conectados pelo mesmo Seamless (Instagram na 1.1). Tabela
// própria — `messaging_channels` —, porque perfil de rede social não é número de
// WhatsApp: não disparia, não tem telefone e não come vaga paga de instância.
export { useMessagingChannels } from "./hooks/useMessagingChannels";
export type { MessagingChannel, MessagingChannelType } from "./hooks/useMessagingChannels";
export { useNotificameTemplates, notificameTemplatesQueryKey } from "./hooks/useNotificameTemplates";
export type { NotificameTemplate, NotificameTemplateStatus } from "./hooks/useNotificameTemplates";
export { NotificameTemplatesCard } from "./components/whatsapp/NotificameTemplatesCard";
export { NotificameTemplateEditor } from "./components/whatsapp/NotificameTemplateEditor";
export { useCreateNotificameTemplate } from "./hooks/useNotificameTemplates";
// ── Inbox multicanal ──────────────────────────────────────────────────────
// O seletor do chat deixou de ser "lista de números de WhatsApp" e passou a ser
// uma união discriminada de CAIXAS. Estes são os tipos e helpers que qualquer
// consumidor cross-module precisa para falar de uma conversa sem presumir que
// ela tem telefone. Cross-module só entra por este barrel (ESLint
// `boundaries/element-types` em modo error).
export { useInboxBoxes } from "./hooks/chat/useInboxBoxes";
export { useSocialContacts } from "./hooks/chat/useSocialContacts";
export { useSocialMessages } from "./hooks/chat/useSocialMessages";
export {
  contactKey,
  contactLabel,
  contactAvatarSeed,
  buildSocialConversationKey,
  isWhatsAppContact,
  isSocialContact,
} from "./hooks/chat/types";
export type {
  SocialContact,
  InboxContact,
  InboxBox,
} from "./hooks/chat/types";
// Regra de origem do postMessage do Seamless, pura e testável (igualdade estrita).
// `seamlessOriginFromStartUrl` é a ÚNICA derivação correta no cliente — a origem
// esperada e a URL do popup precisam sair da MESMA fonte.
export {
  NOTIFICAME_ORIGIN,
  readSeamlessMessage,
  seamlessOriginFromStartUrl,
} from "./lib/notificame-message";
export type { SeamlessOutcome } from "./lib/notificame-message";
export {
  getProviderProfile,
  canUseUazapiActions,
  type WhatsAppProviderId,
  type ProviderProfile,
  type ProviderCapabilities,
  type ConnectKind,
} from "./lib/whatsapp-provider";

// ── Lib: blast media guard (consumido por campaigns/Disparos, #904) ────────
export {
  validateBlastMedia,
  BLAST_MEDIA_LIMITS_MB,
  type BlastMediaType,
  type BlastMediaValidation,
} from "./lib/blast-media-validator";

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
export { RepairingWizard } from "./components/whatsapp-migration";

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

// Chamada de voz (TorqueCalls, S14). O provider vive na raiz do app porque a
// chamada tem que sobreviver ao fechamento da tela que a originou.
export { VoiceCallProvider, useVoiceCallContext } from "./components/voice/VoiceCallProvider";
export { VoiceCallButton } from "./components/voice/VoiceCallButton";
// Quais números de voz ESTE vendedor pode usar. Substitui o antigo
// `useVoipSession` (singular), que devolvia uma sessão qualquer da organização
// sem perguntar de quem ela era.
export { useCallableVoiceNumbers } from "./hooks/useVoipSession";
export type { CallableVoiceNumber } from "./hooks/useVoipSession";
// `useVoipSessions` (plural) é da TELA DE INTEGRAÇÃO e mostra o que o cliente
// precisa administrar — inclusive `pending` e `closed`, que não servem para
// ligar. Sai como `VoipSessionSummary` porque o nome do tipo local dele é
// `VoipSession`, e um nome tão perto de "o número por onde eu ligo" convida ao
// engano exato que esta separação existe para evitar.
export { useVoipSessions, useVoiceSessionsCap } from "./hooks/useVoipSessions";
export type { VoipSession as VoipSessionSummary } from "./hooks/useVoipSessions";
export { useVoiceCall } from "./hooks/useVoiceCall";
export type { CallPhase, VoiceCallState } from "./hooks/useVoiceCall";
export { CALL_DENY_MESSAGES, CallDeniedError } from "./lib/torquecallsApi";
export { VoicePairingDialog } from "./components/voice/VoicePairingDialog";
export {
  createVoiceSession,
  logoutVoiceSession,
  pairVoiceSession,
  VoiceControlError,
  VOICE_CONTROL_MESSAGES,
} from "./lib/torquecallsApi";

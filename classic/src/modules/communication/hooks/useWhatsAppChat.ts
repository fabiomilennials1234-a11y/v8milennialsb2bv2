/**
 * useWhatsAppChat — barrel de re-exports para backwards-compatibility.
 *
 * Onda 2a C12: monolito de 1202 LOC foi dividido em domínios:
 *   - src/hooks/chat/types.ts                — interfaces
 *   - src/hooks/chat/useWhatsAppInstances.ts  — instâncias
 *   - src/hooks/chat/useWhatsAppContacts.ts   — lista de contatos
 *   - src/hooks/chat/useWhatsAppMessages.ts   — mensagens por conversa
 *   - src/hooks/chat/useWhatsAppSend.ts       — mutations + failed cache
 *   - src/hooks/chat/useWhatsAppRealtime.ts   — realtime subscription
 *   - src/hooks/chat/useWhatsAppSzChat.ts     — SZ.chat transfer/session
 *
 * feat/migrate-uazapi-whatsapp: adicionados hooks Uazapi
 *   - src/hooks/useMessageActions.ts          — react/edit/pin/delete/markRead
 *   - src/hooks/useHistorySyncJobs.ts         — history-sync jobs
 *   - src/hooks/useMassSendJobs.ts            — mass-send jobs
 *
 * Todos os imports externos continuam funcionando sem mudança.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type {
  WhatsAppMessage,
  FailedMessage,
  ChatContact,
  ChatContactTag,
  WhatsAppInstanceForUser,
} from "./chat/types";

// ─── Instâncias ───────────────────────────────────────────────────────────────
export {
  useWhatsAppInstancesForUser,
  useActiveWhatsAppInstance,
} from "./chat/useWhatsAppInstances";

// ─── Contatos ─────────────────────────────────────────────────────────────────
export { useWhatsAppContacts } from "./chat/useWhatsAppContacts";

// ─── Mensagens ────────────────────────────────────────────────────────────────
export { useWhatsAppMessages } from "./chat/useWhatsAppMessages";

// ─── Send / Failed / Retry ────────────────────────────────────────────────────
export {
  useSendWhatsAppMessage,
  useSendWhatsAppMedia,
  useFailedMessages,
  useRetryMessage,
} from "./chat/useWhatsAppSend";

// ─── Realtime ─────────────────────────────────────────────────────────────────
export { useWhatsAppMessagesRealtime } from "./chat/useWhatsAppRealtime";

// ─── SZ.chat ──────────────────────────────────────────────────────────────────
export {
  useTransferToSzChatDepartment,
  useActiveSzChatSession,
} from "./chat/useWhatsAppSzChat";

// ─── Uazapi — Message Actions (react/edit/pin/delete/markRead) ────────────────
export {
  useReactMessage,
  useEditMessage,
  usePinMessage,
  useDeleteMessage,
  useMarkMessageRead,
  isFeatureUnavailable,
} from "./useMessageActions";

// ─── Uazapi — History Sync ────────────────────────────────────────────────────
export {
  useHistorySyncJobs,
  useCreateHistorySyncJob,
  useControlHistorySyncJob,
} from "./useHistorySyncJobs";
export type {
  HistorySyncJob,
  HistorySyncJobInsert,
  SyncScope,
} from "./useHistorySyncJobs";

// ─── Uazapi — Mass Send ───────────────────────────────────────────────────────
// NOTE: mass-send é cross-module — entidade `uazapi_sender_jobs` pertence ao
// BC `campaigns` (slice 9). Re-export via API pública do módulo, não deep import.
export {
  useMassSendJobs,
  useCreateMassSend,
  useControlMassSend,
  useRefreshMassSendStatus,
} from "@/modules/campaigns";
export type { UazapiSenderJob } from "@/modules/campaigns";

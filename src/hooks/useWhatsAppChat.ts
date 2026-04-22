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

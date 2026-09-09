import { normalizePhoneForSearch } from "./lead-service.ts";

export interface ReplySnapshot { messageId: string; text: string; direction: "incoming" | "outgoing"; }
export function replySnapshot(message: { message_id: string; normalized_phone: string; content: string | null; message_type: string; direction: string }, number: string): ReplySnapshot | null {
  if (!number || message.normalized_phone !== normalizePhoneForSearch(number)) return null;
  if (message.direction !== "incoming" && message.direction !== "outgoing") return null;
  return { messageId: message.message_id, text: message.content?.trim().slice(0, 4000) || ({ image: "Imagem", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha" }[message.message_type] ?? "Mensagem"), direction: message.direction };
}

/**
 * media-mime — Copilot v2 send-media type/MIME resolution (Slice 6).
 *
 * Centraliza o que a v1 espalhava em heurística multi-camada (send-document.ts):
 * dado o `kind` da biblioteca (image|video|audio-ptt), resolve o messageType do
 * adapter WhatsApp e valida o MIME contra a allow-list do tipo. Fail-CLOSED:
 * MIME fora da allow-list ou kind desconhecido → valid:false (o handler vira
 * fallback explícito, nunca silent-drop). Áudio é PTT (ogg/opus).
 *
 * A allow-list aqui é a MESMA do bucket copilot-v2-send-media (Task 1) — única
 * fonte. `doc`/`pdf` NÃO existem aqui: são knowledge-base, nunca send-media.
 */

export type SendMediaKind = "image" | "video" | "audio";
export type AdapterMessageType = "image" | "video" | "audio";

export const SEND_MEDIA_MIME: Record<SendMediaKind, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/webm"],
  audio: ["audio/ogg", "audio/ogg; codecs=opus", "audio/mpeg", "audio/mp4", "audio/aac"],
};

const KIND_TO_MESSAGE_TYPE: Record<SendMediaKind, AdapterMessageType> = {
  image: "image", video: "video", audio: "audio",
};

export interface MediaDelivery {
  messageType: AdapterMessageType | null;
  valid: boolean;
}

/**
 * Resolve o messageType do adapter + valida o MIME contra o kind. mimeType null
 * é aceito (o bucket já restringe MIME no upload); um mimeType presente que NÃO
 * casa com o kind → valid:false (fail-CLOSED).
 */
export function resolveMediaDelivery(
  kind: SendMediaKind,
  mimeType: string | null | undefined,
): MediaDelivery {
  const messageType = KIND_TO_MESSAGE_TYPE[kind] ?? null;
  if (!messageType) return { messageType: null, valid: false };
  if (mimeType == null) return { messageType, valid: true };
  const allow = SEND_MEDIA_MIME[kind];
  return { messageType, valid: allow.includes(mimeType) };
}

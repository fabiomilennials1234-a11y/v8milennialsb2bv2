/**
 * deriveAttachmentMediaType — mapeia o MIME de um arquivo anexado no chat
 * humano para o `mediaType` que `useSendWhatsAppMedia` espera.
 *
 * Regra espelha o comportamento do composer mobile (imagem → image,
 * vídeo → video, qualquer outra coisa — incl. áudio, PDF, planilha — → document).
 * Áudio vira `document` de propósito: `audio` no send hook roteia pro caminho
 * `ptt` (nota de voz), que não é o que o usuário quer ao anexar um .mp3.
 * Notas de voz têm fluxo próprio (AudioRecorder).
 */
export type AttachmentMediaType = "image" | "video" | "document";

export function deriveAttachmentMediaType(mimeType: string | null | undefined): AttachmentMediaType {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

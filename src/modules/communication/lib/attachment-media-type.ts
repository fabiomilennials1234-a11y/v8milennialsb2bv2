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

/**
 * Teto único pra qualquer anexo do chat humano (desktop, mobile e bubble).
 * Uazapi/WhatsApp aguenta mais que imagem, mas base64 → Storage → provider
 * fica pesado acima disso; 16MB cobre PDF/planilha/vídeo curto sem travar
 * o browser.
 */
export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

/**
 * Lista `accept` compartilhada dos file pickers do chat humano. Imagem, vídeo
 * e documentos de negócio (PDF, Office, CSV, TXT, XML de NF-e, ZIP). Áudio
 * fica de fora de propósito — nota de voz tem fluxo próprio (AudioRecorder).
 */
export const ATTACHMENT_ACCEPT =
  "image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.xml,.zip";

/**
 * Valida um arquivo anexado antes do preview/envio. Retorna a mensagem de
 * erro pronta pra toast, ou null se o arquivo é válido. Centraliza a regra
 * pros 3 composers (desktop, mobile, bubble) não divergirem.
 */
export function getAttachmentValidationError(file: { size: number }): string | null {
  if (file.size === 0) return "Arquivo vazio — selecione outro arquivo.";
  if (file.size > MAX_ATTACHMENT_BYTES) return "Arquivo muito grande (máximo 16MB)";
  return null;
}

export function deriveAttachmentMediaType(mimeType: string | null | undefined): AttachmentMediaType {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

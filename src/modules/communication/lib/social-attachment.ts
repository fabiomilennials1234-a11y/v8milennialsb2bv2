/**
 * Anexo do Direct: classificar e publicar.
 *
 * ⚠️ O FORNECEDOR BUSCA O ARQUIVO — não recebe os bytes. O provider recusa
 * base64 com todas as letras ("o canal oficial exige URL pública"), então o
 * anexo sobe para o nosso bucket ANTES e o que viaja é o endereço.
 *
 * Isso tem uma consequência que vale saber: o arquivo fica publicamente
 * acessível por quem tiver a URL. É o mesmo bucket e o mesmo trato das mídias de
 * WhatsApp — o caminho leva uuid, não nome adivinhável.
 */
/** Tipos que o fornecedor entende. Figurinha não está aqui: ele recusa. */
export type SocialAttachmentType = "image" | "video" | "audio" | "document";

/** Teto do anexo. O fornecedor não documenta limite; este é o nosso. */
export const SOCIAL_ATTACHMENT_MAX_MB = 16;

export type AttachmentCheck =
  | { ok: true; type: SocialAttachmentType }
  | { ok: false; error: string };

const POR_EXTENSAO: Record<string, SocialAttachmentType> = {
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image",
  mp4: "video", mov: "video", webm: "video",
  mp3: "audio", ogg: "audio", oga: "audio", m4a: "audio", wav: "audio",
  pdf: "document", doc: "document", docx: "document",
  xls: "document", xlsx: "document", csv: "document",
};

function extensao(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i >= 0 ? nome.slice(i + 1).toLowerCase() : "";
}

/**
 * Decide o tipo a partir do MIME, caindo para a extensão.
 *
 * MIME mente: arquivo exportado de sistema legado chega como
 * `application/octet-stream`, e aí a extensão é a única pista. Sem essa queda, a
 * tabela de preço em PDF do cliente seria recusada sem motivo visível na tela.
 */
export function classifyAttachment(
  mime: string,
  nome: string,
  sizeBytes: number,
  opcoes: { sticker?: boolean } = {},
): AttachmentCheck {
  if (opcoes.sticker) {
    return { ok: false, error: "O Instagram não aceita figurinhas por aqui" };
  }
  if (!sizeBytes || sizeBytes <= 0) {
    return { ok: false, error: "O arquivo está vazio" };
  }
  if (sizeBytes > SOCIAL_ATTACHMENT_MAX_MB * 1024 * 1024) {
    return { ok: false, error: `O arquivo passa de ${SOCIAL_ATTACHMENT_MAX_MB} MB` };
  }

  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return { ok: true, type: "image" };
  if (m.startsWith("video/")) return { ok: true, type: "video" };
  if (m.startsWith("audio/")) return { ok: true, type: "audio" };

  const porExt = POR_EXTENSAO[extensao(nome)];
  if (porExt) return { ok: true, type: porExt };

  // Desconhecido vira DOCUMENTO em vez de recusa: o fornecedor aceita arquivo
  // genérico, e barrar um .xlsx por não estar numa lista seria pior para o
  // vendedor do que mandá-lo como anexo.
  return { ok: true, type: "document" };
}

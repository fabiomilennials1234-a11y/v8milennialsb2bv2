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
 * Formatos de gravação, do mais compatível para o menos.
 *
 * A ORDEM é o conteúdo desta lista. O `MediaRecorder` sem argumento entrega o
 * default do navegador, que no Chrome é `audio/webm;codecs=opus` — e a Meta
 * documenta, para áudio no Instagram, `aac, m4a, wav, mp4`. **webm não está
 * lá.** Gravar no default é escolher o único formato que a plataforma de destino
 * não lista.
 *
 * `audio/mp4` primeiro porque é o que cai em `.m4a`/AAC, o par que aparece nas
 * duas listas. O webm fica no fim como último recurso: melhor mandar algo que
 * talvez seja recusado do que não deixar gravar.
 */
export const AUDIO_RECORDING_CANDIDATES = [
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

const EXTENSAO_POR_MIME: Array<[RegExp, string]> = [
  [/^audio\/mp4/, "m4a"],
  [/^audio\/aac/, "aac"],
  [/^audio\/mpeg/, "mp3"],
  [/^audio\/ogg/, "ogg"],
  [/^audio\/wav|^audio\/x-wav/, "wav"],
  [/^audio\/webm/, "webm"],
];

/**
 * Escolhe o formato de gravação que este navegador suporta E que a plataforma
 * de destino tem mais chance de aceitar.
 *
 * Recebe o predicado por parâmetro para ser PURA: `MediaRecorder` não existe no
 * jsdom, e um teste que precisasse dele testaria o dublê, não a regra.
 */
export function pickAudioRecordingMime(
  isSupported: (mime: string) => boolean,
): string | undefined {
  return AUDIO_RECORDING_CANDIDATES.find((m) => {
    try {
      return isSupported(m);
    } catch {
      return false;
    }
  });
}

/**
 * A extensão que corresponde ao que foi REALMENTE gravado.
 *
 * Existe porque o nome do arquivo era `.webm` fixo enquanto o conteúdo seguia
 * `rec.mimeType` — no Safari isso produzia um mp4 chamado `.webm`. O
 * `classifyAttachment` cai para a extensão quando o MIME é genérico, e uma
 * extensão que mente sobre o conteúdo é exatamente o caso em que ele erra.
 */
export function audioExtensionForMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  for (const [re, ext] of EXTENSAO_POR_MIME) {
    if (re.test(m)) return ext;
  }
  return "m4a";
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
  opcoes: { sticker?: boolean; allowDocument?: boolean } = {},
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
  if (porExt) return documentoOuRecusa(porExt, opcoes.allowDocument);

  // Desconhecido vira DOCUMENTO em vez de recusa: o fornecedor aceita arquivo
  // genérico, e barrar um .xlsx por não estar numa lista seria pior para o
  // vendedor do que mandá-lo como anexo.
  return documentoOuRecusa("document", opcoes.allowDocument);
}

/**
 * Documento existe no WhatsApp e NÃO no Instagram/Facebook.
 *
 * Medido no node oficial do fornecedor: o seletor de arquivo oferece
 * Documento/Imagem/Vídeo no WhatsApp e só Imagem/Vídeo no Instagram. Recusar
 * AQUI evita o pior dos dois mundos — subir o arquivo para o nosso bucket, pagar
 * o storage, e só então o fornecedor recusar o envio sem dizer por quê.
 */
function documentoOuRecusa(
  tipo: SocialAttachmentType,
  allowDocument?: boolean,
): AttachmentCheck {
  if (tipo === "document" && allowDocument === false) {
    return {
      ok: false,
      error: "O Direct não aceita documentos — mande imagem, vídeo ou áudio",
    };
  }
  return { ok: true, type: tipo };
}

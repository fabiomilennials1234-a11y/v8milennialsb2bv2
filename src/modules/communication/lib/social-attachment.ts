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
 * Formatos de gravação, POR CANAL DE DESTINO.
 *
 * ─── POR QUE DUAS LISTAS ────────────────────────────────────────────────────
 *
 * A lista única era calibrada pela doc do INSTAGRAM (`aac, m4a, wav, mp4`) e
 * mandava `audio/mp4` primeiro. No WhatsApp isso produziu, em produção
 * (2026-08-19, org Chique), uma recusa da Meta:
 *
 *   131053 Media upload error — "Audio file uploaded with mimetype as audio/mp4,
 *   however on processing it is of type application/octet-stream."
 *
 * `ffprobe` sobre os bytes reais: container MP4 com codec **Opus**. O Chromium
 * atende o CONTAINER pedido e escolhe o codec sozinho — pedir `audio/mp4` sem
 * codec não pede AAC, pede "mp4 com o que eu quiser dentro". A mistura não é
 * reconhecida pelo sniffer da Meta.
 *
 * Daí duas mudanças:
 *   1. no WhatsApp, `audio/ogg;codecs=opus` vem PRIMEIRO — é o único formato que
 *      a Cloud API aceita para NOTA DE VOZ ("Voice messages require .ogg files
 *      encoded with the OPUS codec");
 *   2. o mp4 só aparece com o CODEC EXPLÍCITO (`mp4a.40.2` = AAC-LC). Sem o
 *      codec, o navegador repete o defeito acima.
 *
 * `audio/webm` não está em nenhuma das listas da Meta e some daqui para o
 * WhatsApp: mandar o que a plataforma não lista é escolher a recusa.
 */
export const AUDIO_RECORDING_CANDIDATES_INSTAGRAM = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/aac",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export const AUDIO_RECORDING_CANDIDATES_WHATSAPP = [
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/aac",
  "audio/mpeg",
] as const;

/** Mantida para quem já importava a lista única (Instagram é o caso legado). */
export const AUDIO_RECORDING_CANDIDATES = AUDIO_RECORDING_CANDIDATES_INSTAGRAM;

/**
 * É NOTA DE VOZ? Só `.ogg` com OPUS é.
 *
 * O provider marca `voice: true` para o WhatsApp, e a Meta documenta que esse
 * campo EXIGE ogg/opus. Marcar `voice` sobre m4a é prometer uma coisa e entregar
 * outra — daí este predicado decidir entre nota de voz e áudio comum, em vez de
 * o canal decidir sozinho.
 */
export function isVoiceNoteMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  return m.startsWith("audio/ogg") && m.includes("opus");
}

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
  canal: "instagram" | "whatsapp_oficial" = "instagram",
): string | undefined {
  const candidatos =
    canal === "whatsapp_oficial"
      ? AUDIO_RECORDING_CANDIDATES_WHATSAPP
      : AUDIO_RECORDING_CANDIDATES_INSTAGRAM;
  return (candidatos as readonly string[]).find((m) => {
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
/**
 * Os limites da Cloud API do WhatsApp, por tipo.
 *
 * Fonte: developers.facebook.com/docs/whatsapp/cloud-api/reference/media —
 * "Supported Media Types". Eles são MAIS DUROS que os nossos em imagem (5 MB, e
 * só JPEG/PNG) e mais frouxos em documento (100 MB).
 *
 * Existe porque o teto único de 16 MB e o `image/*` aberto foram calibrados para
 * o Direct. Mandar um `.webp` ou um JPEG de 8 MB pelo canal oficial repetiria o
 * sumiço silencioso do áudio de 19/08: nós aceitamos, o fornecedor aceita, a Meta
 * recusa por callback, e a tela segue dizendo "enviado".
 */
const LIMITES_WHATSAPP: Record<
  SocialAttachmentType,
  { mb: number; mimes?: RegExp; comoDizer: string }
> = {
  image: {
    mb: 5,
    mimes: /^image\/(jpeg|jpg|png)$/,
    comoDizer: "O WhatsApp aceita imagem só em JPEG ou PNG, até 5 MB",
  },
  video: {
    mb: 16,
    mimes: /^video\/(mp4|3gpp)$/,
    comoDizer: "O WhatsApp aceita vídeo só em MP4 ou 3GPP, até 16 MB",
  },
  audio: { mb: 16, comoDizer: "O áudio passa de 16 MB" },
  document: { mb: 100, comoDizer: "O documento passa de 100 MB" },
};

export function classifyAttachment(
  mime: string,
  nome: string,
  sizeBytes: number,
  opcoes: {
    sticker?: boolean;
    allowDocument?: boolean;
    /** O canal de destino. Só o oficial aplica os limites da Meta. */
    canal?: "instagram" | "whatsapp_oficial";
  } = {},
): AttachmentCheck {
  if (opcoes.sticker) {
    return { ok: false, error: "O Instagram não aceita figurinhas por aqui" };
  }
  if (!sizeBytes || sizeBytes <= 0) {
    return { ok: false, error: "O arquivo está vazio" };
  }
  const oficial = opcoes.canal === "whatsapp_oficial";

  // O teto genérico continua valendo onde a Meta não impõe o dela. No canal
  // oficial cada tipo tem o seu, conferido logo abaixo.
  if (!oficial && sizeBytes > SOCIAL_ATTACHMENT_MAX_MB * 1024 * 1024) {
    return { ok: false, error: `O arquivo passa de ${SOCIAL_ATTACHMENT_MAX_MB} MB` };
  }

  const m = (mime || "").toLowerCase();

  /** Aplica o limite do canal oficial ao tipo já decidido. */
  const conferirLimite = (tipo: SocialAttachmentType): AttachmentCheck => {
    if (!oficial) return { ok: true, type: tipo };
    const lim = LIMITES_WHATSAPP[tipo];
    if (lim.mimes && !lim.mimes.test(m)) return { ok: false, error: lim.comoDizer };
    if (sizeBytes > lim.mb * 1024 * 1024) return { ok: false, error: lim.comoDizer };
    return { ok: true, type: tipo };
  };

  if (m.startsWith("image/")) return conferirLimite("image");
  if (m.startsWith("video/")) return conferirLimite("video");
  if (m.startsWith("audio/")) return conferirLimite("audio");

  const porExt = POR_EXTENSAO[extensao(nome)];
  if (porExt) {
    const decidido = documentoOuRecusa(porExt, opcoes.allowDocument);
    return decidido.ok ? conferirLimite(decidido.type) : decidido;
  }

  // Desconhecido vira DOCUMENTO em vez de recusa: o fornecedor aceita arquivo
  // genérico, e barrar um .xlsx por não estar numa lista seria pior para o
  // vendedor do que mandá-lo como anexo.
  const generico = documentoOuRecusa("document", opcoes.allowDocument);
  return generico.ok ? conferirLimite("document") : generico;
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

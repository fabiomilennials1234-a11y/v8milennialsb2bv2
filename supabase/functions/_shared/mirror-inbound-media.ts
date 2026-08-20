/**
 * mirror-inbound-media — o arquivo que o cliente mandou, servido de casa.
 *
 * ─── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * As 2 caixas de Instagram receberam 14 reels, 8 áudios, 2 imagens e 1 menção de
 * story, e 100% delas ficaram com `media_url` NULO. A conversa mostra
 * "[Mídia indisponível]" e o banco parece correto — a linha existe, o tipo está
 * certo, só o arquivo não está em lugar nenhum.
 *
 * ─── POR QUE ESPELHAR, E NÃO GUARDAR O LINK ─────────────────────────────────
 *
 * A URL do fornecedor é assinada e temporária. Guardá-la é guardar um prazo: a
 * conversa fica correta hoje e vira ícone quebrado depois — e nesse dia não há o
 * que consertar, porque o arquivo original nunca foi nosso.
 *
 * ─── DUAS COISAS MEDIDAS, E CONTRA-INTUITIVAS ───────────────────────────────
 *
 * 1. O CDN ENTREGA SEM TOKEN. `curl -r 0-1024` numa URL real do
 *    `lookaside.fbsbx.com/ig_messaging_cdn` devolveu HTTP 206. O endpoint de
 *    download do fornecedor (`POST /v1/channels/whatsapp/media`) fica como
 *    plano B para o caso do WhatsApp, que ainda não recebeu arquivo nenhum.
 * 2. O MIME DECLARADO MENTE. O mesmo arquivo que o CDN serve como `image/jpeg`
 *    vem anunciado como `"text/html"` no corpo do webhook — em todos os áudios,
 *    imagens, reels e stories medidos, sem exceção.
 */

export type EspecieDeArquivo = "audio" | "imagem" | "video" | "documento" | "sticker" | "indefinida";

export interface EspelhoRecebidoDeps {
  organizationId: string;
  especie: EspecieDeArquivo;
  /** O que o fornecedor declarou. Só entra como último recurso. */
  mimeDeclarado?: string | null;
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        data: Uint8Array,
        opts?: { contentType?: string; upsert?: boolean },
      ): Promise<{ error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
  fetchImpl?: typeof fetch;
  /**
   * O download AUTENTICADO, pelo endpoint do fornecedor.
   *
   * Só é usado quando o acesso direto é RECUSADO — o CDN do Instagram entrega
   * aberto, e gastar uma chamada paga ali seria desperdício por arquivo.
   *
   * Ausente = sem plano B: o 401 devolve a URL original em vez de inventar
   * caminho.
   */
  baixarPeloFornecedor?: (url: string, mime: string | null) => Promise<Response | null>;
}

export interface ResultadoDoEspelho {
  /** Onde a bolha deve buscar. A ORIGINAL quando o espelhamento não deu certo. */
  url: string;
  espelhada: boolean;
  /** O content-type real, quando conseguimos vê-lo. */
  mime: string | null;
}

const EXTENSAO_POR_MIME: Array<[RegExp, string]> = [
  [/jpe?g/, "jpg"],
  [/png/, "png"],
  [/webp/, "webp"],
  [/gif/, "gif"],
  [/ogg|opus/, "ogg"],
  [/mpeg|mp3/, "mp3"],
  [/mp4|m4a/, "mp4"],
  [/webm/, "webm"],
  [/pdf/, "pdf"],
];

/**
 * Um content-type que o storage aceite.
 *
 * ⚠️ O ENDPOINT DE DOWNLOAD DO FORNECEDOR RESPONDE COM MIME INVÁLIDO. Medido em
 * 2026-08-20:
 *
 *   Content-Type: application/image/jpeg
 *   Content-Type: application/audio/ogg; codecs=opus
 *
 * Duas barras. Não é mime — e o corpo do webhook, no mesmo evento, traz o certo
 * (`image/jpeg`). O storage recusa o upload, o espelhamento devolve a URL
 * original e a bolha continua quebrada.
 *
 * O sintoma é cruel: parece que o download falhou, quando ele funcionou e quem
 * recusou foi o nosso próprio armazenamento.
 *
 * Ordem: o da resposta se for válido, senão o que o envelope declarou, senão
 * `application/octet-stream` — que ao menos deixa o arquivo baixável.
 *
 * ⚠️ O PARÂMETRO DEPOIS DO `;` É PODADO, e isto também foi medido:
 *
 *   Content-Type: audio/ogg; codecs=opus  → 400 invalid_mime_type
 *   Content-Type: audio/ogg               → 200
 *
 * Era a única diferença entre a foto, que passou a funcionar, e o áudio, que
 * continuou quebrado. O codec não faz falta: o container Ogg já diz ao navegador
 * o que tocar.
 */
export function mimeUtilizavel(
  daResposta: string | null | undefined,
  doEnvelope: string | null | undefined,
): string {
  // `tipo/subtipo`, com parâmetros opcionais depois de `;`. `audio/ogg;
  // codecs=opus` é VÁLIDO e o codec importa para o áudio tocar.
  const valido = (m: string | null | undefined) =>
    !!m && /^[a-z]+\/[a-z0-9][a-z0-9.+-]*(\s*;.*)?$/i.test(m.trim());

  // Poda o que vem depois do `;`. O storage recusa mime com parâmetro.
  const podar = (m: string) => m.split(";")[0].trim();

  if (valido(daResposta)) return podar(daResposta!);
  if (valido(doEnvelope)) return podar(doEnvelope!);
  return "application/octet-stream";
}

/** Extensão a partir do content-type REAL. Arquivo sem nome não abre em nada. */
function extensaoDe(mime: string | null): string {
  const t = (mime ?? "").toLowerCase();
  for (const [padrao, ext] of EXTENSAO_POR_MIME) if (padrao.test(t)) return ext;
  return "bin";
}

/**
 * Baixa e republica. Falha SEMPRE devolve a original.
 *
 * Mídia nunca decide se a conversa existe: um webhook que falha por causa de um
 * arquivo perde a mensagem, e a mensagem é o produto. Este módulo não lança.
 */
export async function espelharMidiaRecebida(
  url: string,
  deps: EspelhoRecebidoDeps,
): Promise<ResultadoDoEspelho> {
  const buscar = deps.fetchImpl ?? fetch;

  try {
    let r = await buscar(url);

    // ⚠️ O CDN DO WHATSAPP OFICIAL NÃO É ABERTO. Medido em 2026-08-20, no
    // primeiro áudio real recebido na Chique:
    //
    //   GET lookaside.fbsbx.com/whatsapp_business/attachments/?mid=… → 401
    //
    // O do Instagram entregava 206 sem token, e foi com ele que este módulo
    // nasceu. Sem o download autenticado, a bolha fica quebrada — foi o que
    // apareceu na tela como "Não foi possível reproduzir o áudio".
    if ((r.status === 401 || r.status === 403) && deps.baixarPeloFornecedor) {
      const alternativa = await deps.baixarPeloFornecedor(url, deps.mimeDeclarado ?? null);
      if (alternativa?.ok) r = alternativa;
    }

    if (!r.ok) return { url, espelhada: false, mime: null };

    // O content-type da RESPOSTA é a verdade. O declarado só entra se o CDN não
    // disser nada — e mesmo aí é suspeito.
    // ⚠️ SANEADO. O endpoint de download do fornecedor devolve mime de duas
    // barras, que o storage recusa — ver `mimeUtilizavel`.
    const mime = mimeUtilizavel(r.headers.get("content-type"), deps.mimeDeclarado);
    const bytes = new Uint8Array(await r.arrayBuffer());
    // Zero byte não vira link: seria uma bolha de mídia que nunca abre, o que é
    // pior que a URL original, que ao menos pode funcionar.
    if (bytes.byteLength === 0) return { url, espelhada: false, mime };

    const caminho =
      `notificame/inbound/${deps.organizationId}/${deps.especie}-${crypto.randomUUID()}.${extensaoDe(mime)}`;

    const { error } = await deps.storage.from("media").upload(caminho, bytes, {
      contentType: mime,
      upsert: false,
    });
    if (error) return { url, espelhada: false, mime };

    const publica = deps.storage.from("media").getPublicUrl(caminho).data.publicUrl;
    return publica
      ? { url: publica, espelhada: true, mime }
      : { url, espelhada: false, mime };
  } catch {
    return { url, espelhada: false, mime: null };
  }
}

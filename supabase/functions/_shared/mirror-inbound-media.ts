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
    const r = await buscar(url);
    if (!r.ok) return { url, espelhada: false, mime: null };

    // O content-type da RESPOSTA é a verdade. O declarado só entra se o CDN não
    // disser nada — e mesmo aí é suspeito.
    const mime = r.headers.get("content-type") ?? deps.mimeDeclarado ?? null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    // Zero byte não vira link: seria uma bolha de mídia que nunca abre, o que é
    // pior que a URL original, que ao menos pode funcionar.
    if (bytes.byteLength === 0) return { url, espelhada: false, mime };

    const caminho =
      `notificame/inbound/${deps.organizationId}/${deps.especie}-${crypto.randomUUID()}.${extensaoDe(mime)}`;

    const { error } = await deps.storage.from("media").upload(caminho, bytes, {
      contentType: mime ?? "application/octet-stream",
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

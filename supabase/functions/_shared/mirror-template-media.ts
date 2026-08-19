/**
 * Espelhamento da mídia de cabeçalho de template.
 *
 * ─── O DEFEITO QUE ISTO FECHA ───────────────────────────────────────────────
 *
 * A Meta guarda o arquivo do cabeçalho junto do template aprovado e devolve a URL
 * dele na listagem — algo como
 * `https://scontent.whatsapp.net/v/t61.29466-34/…&oe=6AAD8D57`.
 *
 * Parece um link público, e é: NÓS baixamos com HTTP 200 (medido). Mas o
 * pipeline de envio da PRÓPRIA META recebe 403 nele:
 *
 *   131053 Media upload error
 *   details: Downloading media from weblink failed with http code 403, Forbidden
 *
 * A URL assinada serve para EXIBIR o template, não para ser rebaixada no envio.
 * Mandá-la como `link` é uma falha garantida — medido em produção 2026-08-19.
 *
 * A saída é espelhar: baixamos (que funciona) e servimos de um endereço nosso
 * (que a Meta consegue buscar). Fica no SERVIDOR e não no navegador porque o CDN
 * da Meta não manda cabeçalho de CORS — o front não consegue ler os bytes.
 */

/** Hosts cuja URL não sobrevive ao fetch da Meta. */
const HOSTS_A_ESPELHAR = [".whatsapp.net", ".fbcdn.net", ".cdninstagram.com"];

/**
 * Precisa espelhar? PURO.
 *
 * A regra é por HOST, e estreita de propósito: espelhar tudo faria o produto
 * rebaixar e republicar imagens que o cliente já hospeda bem — custo, latência e
 * uma segunda cópia de um arquivo que não é nosso.
 */
export function precisaEspelhar(url: string | null | undefined): boolean {
  const bruto = (url ?? "").trim();
  if (!bruto.startsWith("http")) return false;
  try {
    const host = new URL(bruto).hostname.toLowerCase();
    return HOSTS_A_ESPELHAR.some((sufixo) => host.endsWith(sufixo));
  } catch {
    return false;
  }
}

/** Extensão a partir do content-type, para o arquivo espelhado não nascer sem nome. */
function extensaoDe(contentType: string | null): string {
  const t = (contentType ?? "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("mp4")) return "mp4";
  if (t.includes("pdf")) return "pdf";
  return "bin";
}

export interface EspelhoDeps {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        data: Uint8Array | ArrayBuffer | Blob,
        opts?: { contentType?: string; upsert?: boolean },
      ): Promise<{ error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
  fetchImpl?: typeof fetch;
}

/**
 * Devolve uma URL que a Meta consegue buscar.
 *
 * Se não precisar espelhar, devolve a original — o caminho comum não paga nada.
 * Se o espelhamento FALHAR, devolve a original também: um envio que talvez
 * funcione é melhor que um erro nosso no lugar de uma tentativa. A recusa da Meta
 * já é visível na conversa.
 */
export async function espelharMidiaDeTemplate(
  url: string,
  organizationId: string,
  deps: EspelhoDeps,
): Promise<string> {
  if (!precisaEspelhar(url)) return url;

  const buscar = deps.fetchImpl ?? fetch;
  try {
    const r = await buscar(url);
    if (!r.ok) return url;

    const tipo = r.headers.get("content-type");
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.byteLength === 0) return url;

    const caminho =
      `notificame/outbound/${organizationId}/template-header-${crypto.randomUUID()}.${extensaoDe(tipo)}`;

    const { error } = await deps.storage.from("media").upload(caminho, bytes, {
      contentType: tipo ?? "application/octet-stream",
      upsert: false,
    });
    if (error) return url;

    return deps.storage.from("media").getPublicUrl(caminho).data.publicUrl || url;
  } catch {
    return url;
  }
}

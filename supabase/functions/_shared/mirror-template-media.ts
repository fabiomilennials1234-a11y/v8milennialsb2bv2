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

// ─── O envelope inteiro ──────────────────────────────────────────────────────

/** Os tipos de parâmetro que carregam ARQUIVO — os únicos com link a espelhar. */
const TIPOS_DE_MIDIA = ["image", "video", "document"];

/** O link de um parâmetro de mídia, esteja ele na raiz ou no objeto aninhado. */
function linkDoParametro(par: Record<string, unknown>, tipo: string): string {
  const aninhado = (par[tipo] ?? {}) as Record<string, unknown>;
  if (typeof par.link === "string" && par.link) return par.link;
  return typeof aninhado.link === "string" ? aninhado.link : "";
}

function tipoDeMidiaDe(p: unknown): string | null {
  const par = (p ?? {}) as Record<string, unknown>;
  const tipo = String(par.type ?? "").toLowerCase();
  return TIPOS_DE_MIDIA.includes(tipo) ? tipo : null;
}

/**
 * Espelha o que precisar dentro dos componentes de envio de um template.
 *
 * ─── POR QUE ESTA FUNÇÃO EXISTE, E NÃO SÓ A DE CIMA ─────────────────────────
 *
 * O que os dois caminhos de envio têm em mãos não é uma URL solta: é o envelope
 * da Graph já montado, com o link enterrado em `components[].parameters[].image.link`.
 * A caminhada até ele estava ESCRITA À MÃO dentro do proxy — o caminho do chat —
 * e o caminho da automação não tinha nenhuma (#1706). Duplicá-la seria criar o
 * segundo lugar onde a mesma decisão mora, e o sintoma de uma divergência é uma
 * mensagem que some sem rastro.
 *
 * ⚠️ QUANDO NADA PRECISA ESPELHAR, DEVOLVE O MESMO ARRAY. Não é micro-otimização:
 * é a garantia de que template sem cabeçalho de mídia — a maioria — não paga um
 * download, um upload, nem uma remontagem do envelope que a Meta valida campo a
 * campo.
 *
 * ⚠️ O link é gravado NOS DOIS LUGARES (raiz e aninhado) porque é assim que o
 * proxy já o entregava e é o que os providers leem. Escrever só num deles
 * mudaria, em silêncio, o que o canal do chat manda hoje.
 */
export async function espelharMidiaDosComponentes(
  components: unknown[] | null | undefined,
  organizationId: string,
  deps: EspelhoDeps,
): Promise<unknown[]> {
  const lista = components ?? [];

  // Varredura PURA primeiro. Decidir antes de tocar em I/O é o que deixa o
  // caminho comum sair por aqui sem custo nenhum.
  const temAlgoAEspelhar = lista.some((c) => {
    const comp = (c ?? {}) as Record<string, unknown>;
    if (!Array.isArray(comp.parameters)) return false;
    return (comp.parameters as unknown[]).some((p) => {
      const tipo = tipoDeMidiaDe(p);
      return tipo !== null &&
        precisaEspelhar(linkDoParametro((p ?? {}) as Record<string, unknown>, tipo));
    });
  });
  if (!temAlgoAEspelhar) return lista;

  return await Promise.all(
    lista.map(async (c) => {
      const comp = (c ?? {}) as Record<string, unknown>;
      if (!Array.isArray(comp.parameters)) return c;

      const parametros = await Promise.all(
        (comp.parameters as unknown[]).map(async (p) => {
          const tipo = tipoDeMidiaDe(p);
          if (!tipo) return p;

          const par = (p ?? {}) as Record<string, unknown>;
          const link = linkDoParametro(par, tipo);
          if (!precisaEspelhar(link)) return p;

          const espelhada = await espelharMidiaDeTemplate(link, organizationId, deps);
          const aninhado = (par[tipo] ?? {}) as Record<string, unknown>;
          return { ...par, [tipo]: { ...aninhado, link: espelhada }, link: espelhada };
        }),
      );

      return { ...comp, parameters: parametros };
    }),
  );
}

/**
 * O espelhamento do arquivo que o CLIENTE mandou.
 *
 * ─── O QUE ISTO CONSERTA ────────────────────────────────────────────────────
 *
 * Medido em produção (2026-08-19): as 2 caixas de Instagram têm 100% da mídia
 * recebida com `media_url` NULO — 14 reels, 8 áudios, 2 imagens, 1 menção de
 * story. A conversa mostra "[Mídia indisponível]" para um áudio que o cliente
 * gravou, e ninguém percebeu porque o banco parece correto.
 *
 * Medido também, com `curl -r 0-1024` numa URL real: o CDN do fornecedor
 * ENTREGA sem token (HTTP 206) e declara `image/jpeg` — enquanto o corpo do
 * webhook dizia `"text/html"` para o mesmo arquivo. O content-type da RESPOSTA é
 * a verdade; o do envelope não é.
 */
import { describe, expect, it, vi } from "vitest";

import {
  espelharMidiaRecebida,
  mimeUtilizavel,
} from "../../supabase/functions/_shared/mirror-inbound-media.ts";

const CDN_IG =
  "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2578845579236720&signature=Ab1H_F4";

function storageFake(erro?: string) {
  const uploads: Array<{ path: string; bytes: number; contentType?: string }> = [];
  return {
    uploads,
    storage: {
      from: () => ({
        upload: async (path: string, data: Uint8Array, opts?: { contentType?: string }) => {
          uploads.push({ path, bytes: data.byteLength, contentType: opts?.contentType });
          return { error: erro ? { message: erro } : null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://nosso.storage/${path}` } }),
      }),
    },
  };
}

const resposta = (bytes = 32, tipo = "image/jpeg") =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": tipo } });

describe("espelharMidiaRecebida", () => {
  it("baixa do CDN e devolve endereço NOSSO", async () => {
    const fake = storageFake();
    const r = await espelharMidiaRecebida(CDN_IG, {
      organizationId: "org-1",
      especie: "imagem",
      storage: fake.storage,
      fetchImpl: vi.fn().mockResolvedValue(resposta(4096)),
    });

    expect(r.url).toMatch(/^https:\/\/nosso\.storage\//);
    expect(r.espelhada).toBe(true);
    expect(fake.uploads[0].bytes).toBe(4096);
    expect(fake.uploads[0].path).toContain("org-1");
  });

  it("grava o content-type da RESPOSTA, não o que o fornecedor declarou", async () => {
    // O envelope dizia "text/html" para um jpeg. Gravar o declarado faria o
    // navegador tentar renderizar a foto do cliente como página.
    const fake = storageFake();
    await espelharMidiaRecebida(CDN_IG, {
      organizationId: "org-1",
      especie: "imagem",
      mimeDeclarado: "text/html",
      storage: fake.storage,
      fetchImpl: vi.fn().mockResolvedValue(resposta(10, "image/jpeg")),
    });

    expect(fake.uploads[0].contentType).toBe("image/jpeg");
    expect(fake.uploads[0].path).toMatch(/\.jpg$/);
  });
});

/**
 * As saídas de falha.
 *
 * Escritas DEPOIS do módulo, e vale registrar: o desenho veio inteiro do gêmeo
 * `mirror-template-media`, que já está em produção. São testes de guarda, não de
 * descoberta — passaram de primeira, e o que eles impedem é alguém "melhorar"
 * este arquivo lançando exceção.
 */
describe("falha nunca troca a mensagem por um erro nosso", () => {
  const casos: Array<[string, () => unknown]> = [
    ["CDN devolve 404", () => vi.fn().mockResolvedValue(new Response("", { status: 404 }))],
    ["rede cai", () => vi.fn().mockRejectedValue(new Error("ECONNRESET"))],
    ["arquivo vem vazio", () => vi.fn().mockResolvedValue(resposta(0))],
  ];

  for (const [nome, montarFetch] of casos) {
    it(`${nome} → devolve a URL original`, async () => {
      const r = await espelharMidiaRecebida(CDN_IG, {
        organizationId: "org-1",
        especie: "imagem",
        storage: storageFake().storage,
        fetchImpl: montarFetch() as typeof fetch,
      });

      expect(r.url).toBe(CDN_IG);
      expect(r.espelhada).toBe(false);
    });
  }

  it("upload rejeitado → devolve a URL original", async () => {
    const r = await espelharMidiaRecebida(CDN_IG, {
      organizationId: "org-1",
      especie: "imagem",
      storage: storageFake("sem permissão").storage,
      fetchImpl: vi.fn().mockResolvedValue(resposta()),
    });

    expect(r.url).toBe(CDN_IG);
    expect(r.espelhada).toBe(false);
  });
});

/**
 * O CDN DO WHATSAPP OFICIAL NÃO É ABERTO.
 *
 * Medido em 2026-08-20, com o primeiro áudio real recebido na Chique:
 *
 *   GET https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=… → 401
 *
 * O do Instagram (`ig_messaging_cdn`) entregava com 206 sem token nenhum, e foi
 * com ele que este módulo nasceu. O do WhatsApp Business exige credencial — e o
 * comentário deste arquivo chamava o endpoint de download do fornecedor de
 * "plano B para o caso do WhatsApp, que ainda não recebeu arquivo nenhum".
 *
 * Recebeu. O plano B é o único caminho, e sem ele a bolha fica quebrada: foi o
 * que apareceu na tela como "Não foi possível reproduzir o áudio".
 */
describe("CDN que exige credencial", () => {
  it("401 no acesso direto cai para o download do fornecedor", async () => {
    const fake = storageFake();
    const direto = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const peloFornecedor = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(2048), {
        status: 200,
        headers: { "content-type": "audio/ogg" },
      }),
    );

    const r = await espelharMidiaRecebida(
      "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123",
      {
        organizationId: "org-1",
        especie: "audio",
        storage: fake.storage,
        fetchImpl: direto,
        baixarPeloFornecedor: peloFornecedor,
      },
    );

    expect(direto, "tentou o caminho barato primeiro").toHaveBeenCalled();
    expect(peloFornecedor, "não usou o endpoint autenticado").toHaveBeenCalled();
    expect(r.espelhada).toBe(true);
    expect(fake.uploads[0].bytes).toBe(2048);
  });

  it("acesso direto que FUNCIONA não gasta o endpoint autenticado", async () => {
    // O do Instagram entrega aberto. Chamar o endpoint do fornecedor ali seria
    // uma chamada paga por arquivo, sem motivo.
    const peloFornecedor = vi.fn();
    await espelharMidiaRecebida(CDN_IG, {
      organizationId: "org-1",
      especie: "imagem",
      storage: storageFake().storage,
      fetchImpl: vi.fn().mockResolvedValue(resposta(64)),
      baixarPeloFornecedor: peloFornecedor,
    });

    expect(peloFornecedor).not.toHaveBeenCalled();
  });

  it("sem o baixador injetado, 401 devolve a original — não inventa caminho", async () => {
    const r = await espelharMidiaRecebida("https://lookaside.fbsbx.com/x?mid=1", {
      organizationId: "org-1",
      especie: "audio",
      storage: storageFake().storage,
      fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 401 })),
    });

    expect(r.espelhada).toBe(false);
  });
});

/**
 * O CONTENT-TYPE MALFORMADO DO ENDPOINT DE DOWNLOAD.
 *
 * Medido em produção 2026-08-20, logo depois de o download autenticado entrar:
 * a mídia continuou quebrada, e a linha gravada trazia
 *
 *   mime: "application/image/jpeg"
 *   mime: "application/audio/ogg; codecs=opus"
 *
 * O corpo do webhook traz o mime CERTO (`image/jpeg`). O prefixo veio da
 * resposta do endpoint de download do fornecedor, que responde com um
 * content-type de DUAS barras — que não é mime válido. O storage recusa o
 * upload, o espelhamento devolve a URL original, e a bolha segue quebrada.
 *
 * O sintoma é cruel: parece que o download falhou, quando na verdade ele
 * funcionou e quem recusou foi o nosso próprio armazenamento.
 */
describe("content-type malformado", () => {
  it("duas barras não vão para o storage — cai para o mime do envelope", async () => {
    const fake = storageFake();
    const r = await espelharMidiaRecebida(CDN_IG, {
      organizationId: "org-1",
      especie: "imagem",
      mimeDeclarado: "image/jpeg",
      storage: fake.storage,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(new Uint8Array(512), {
          status: 200,
          headers: { "content-type": "application/image/jpeg" },
        }),
      ),
    });

    expect(r.espelhada, "o upload foi recusado por um mime inválido").toBe(true);
    expect(fake.uploads[0].contentType).toBe("image/jpeg");
    expect(fake.uploads[0].path).toMatch(/\.jpg$/);
    expect(r.mime).toBe("image/jpeg");
  });

  it("sem mime no envelope, o inválido vira octet-stream — nunca vai cru", async () => {
    const fake = storageFake();
    await espelharMidiaRecebida(CDN_IG, {
      organizationId: "org-1",
      especie: "indefinida",
      storage: fake.storage,
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(new Uint8Array(64), {
          status: 200,
          headers: { "content-type": "application/audio/ogg; codecs=opus" },
        }),
      ),
    });

    expect(fake.uploads[0].contentType).toBe("application/octet-stream");
  });

  /**
   * ⚠️ ESTE TESTE JÁ AFIRMOU O CONTRÁRIO, e estava errado.
   *
   * Eu escrevi que `audio/ogg; codecs=opus` devia passar inteiro, "porque o
   * codec importa para tocar o áudio". Medido contra o storage de produção:
   *
   *   Content-Type: audio/ogg; codecs=opus  → 400 invalid_mime_type (415)
   *   Content-Type: audio/ogg               → 200
   *
   * O parâmetro depois do `;` é RECUSADO. E o codec não fazia falta: o container
   * Ogg já diz ao navegador o que tocar. Foi por isso que a imagem passou a
   * funcionar e o áudio não — a única diferença entre os dois era esse sufixo.
   */
  it("parâmetro depois do `;` é PODADO — o storage o recusa", () => {
    expect(mimeUtilizavel("audio/ogg; codecs=opus", null)).toBe("audio/ogg");
    expect(mimeUtilizavel("image/jpeg", null)).toBe("image/jpeg");
    expect(mimeUtilizavel("text/plain;charset=utf-8", null)).toBe("text/plain");
  });

  it("reconhece o inválido de várias formas", () => {
    expect(mimeUtilizavel("application/image/jpeg", "image/jpeg")).toBe("image/jpeg");
    expect(mimeUtilizavel("", "image/png")).toBe("image/png");
    expect(mimeUtilizavel("lixo", "image/png")).toBe("image/png");
    expect(mimeUtilizavel(null, null)).toBe("application/octet-stream");
  });
});

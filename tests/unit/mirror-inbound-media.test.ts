/**
 * O espelhamento do arquivo que o CLIENTE mandou.
 *
 * ─── O QUE ISTO CONSERTA ────────────────────────────────────────────────────
 *
 * Medido em produção (2026-08-19): as 4 caixas de Instagram têm 100% da mídia
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

import { espelharMidiaRecebida } from "../../supabase/functions/_shared/mirror-inbound-media.ts";

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

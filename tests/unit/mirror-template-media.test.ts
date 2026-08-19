/**
 * O espelhamento da imagem aprovada do template.
 *
 * Medido em produção (2026-08-19): a URL que a listagem devolve para o cabeçalho
 * é do CDN da Meta, assinada. NÓS baixamos com HTTP 200 — conferido com curl —, e
 * o pipeline de envio da PRÓPRIA META recebe 403 nela:
 *
 *   131053 Media upload error
 *   details: Downloading media from weblink failed with http code 403, Forbidden
 *
 * Foi o quarto erro em sequência do mesmo template, e o único causado por uma
 * "melhoria" minha: usar a URL do exemplo como link de envio parecia evitar um
 * upload e produzia uma falha garantida.
 */
import { describe, expect, it, vi } from "vitest";

import {
  espelharMidiaDeTemplate,
  precisaEspelhar,
} from "../../supabase/functions/_shared/mirror-template-media.ts";

const CDN_META =
  "https://scontent.whatsapp.net/v/t61.29466-34/684230101_103_n.png?ccb=1-7&oe=6AAD8D57";

describe("precisaEspelhar", () => {
  it("reconhece o CDN da Meta pelos hosts que ela usa", () => {
    expect(precisaEspelhar(CDN_META)).toBe(true);
    expect(precisaEspelhar("https://scontent.xx.fbcdn.net/v/foto.jpg")).toBe(true);
    expect(precisaEspelhar("https://scontent.cdninstagram.com/v/foto.jpg")).toBe(true);
  });

  it("NÃO espelha o que já é nosso nem o que é do cliente", () => {
    // Espelhar tudo faria o produto rebaixar e republicar imagem que o cliente já
    // hospeda bem: custo, latência e uma segunda cópia de um arquivo alheio.
    expect(precisaEspelhar("https://jsjsmuncfkbsbzqzqhfq.supabase.co/storage/v1/x.png")).toBe(false);
    expect(precisaEspelhar("https://cliente.com.br/banner.jpg")).toBe(false);
  });

  it("entrada inválida não vira espelhamento", () => {
    for (const ruim of ["", "   ", "não é url", "ftp://x/y.png", null, undefined]) {
      expect(precisaEspelhar(ruim)).toBe(false);
    }
  });
});

function storageFake(overrides?: { uploadError?: string }) {
  const uploads: Array<{ path: string; bytes: number; contentType?: string }> = [];
  return {
    uploads,
    storage: {
      from: () => ({
        upload: async (
          path: string,
          data: Uint8Array,
          opts?: { contentType?: string },
        ) => {
          uploads.push({ path, bytes: data.byteLength, contentType: opts?.contentType });
          return { error: overrides?.uploadError ? { message: overrides.uploadError } : null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://nosso.storage/${path}` },
        }),
      }),
    },
  };
}

const respostaOk = (bytes = 10) =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

describe("espelharMidiaDeTemplate", () => {
  it("baixa do CDN e devolve uma URL NOSSA", async () => {
    const fake = storageFake();
    const url = await espelharMidiaDeTemplate(CDN_META, "org-1", {
      storage: fake.storage,
      fetchImpl: vi.fn().mockResolvedValue(respostaOk(10111)),
    });

    expect(url).toMatch(/^https:\/\/nosso\.storage\//);
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0].path).toContain("org-1");
    expect(fake.uploads[0].path).toMatch(/\.png$/);
    expect(fake.uploads[0].bytes).toBe(10111);
  });

  it("URL que não é do CDN passa direto, sem baixar nada", async () => {
    const buscar = vi.fn();
    const url = await espelharMidiaDeTemplate("https://cliente.com/x.jpg", "org-1", {
      storage: storageFake().storage,
      fetchImpl: buscar,
    });

    expect(url).toBe("https://cliente.com/x.jpg");
    expect(buscar).not.toHaveBeenCalled();
  });

  it("falha no download devolve a URL original — não troca tentativa por erro nosso", async () => {
    const url = await espelharMidiaDeTemplate(CDN_META, "org-1", {
      storage: storageFake().storage,
      fetchImpl: vi.fn().mockResolvedValue(new Response("", { status: 404 })),
    });

    expect(url).toBe(CDN_META);
  });

  it("falha no upload também devolve a original", async () => {
    const url = await espelharMidiaDeTemplate(CDN_META, "org-1", {
      storage: storageFake({ uploadError: "sem permissão" }).storage,
      fetchImpl: vi.fn().mockResolvedValue(respostaOk()),
    });

    expect(url).toBe(CDN_META);
  });

  it("rede caindo não derruba o envio", async () => {
    const url = await espelharMidiaDeTemplate(CDN_META, "org-1", {
      storage: storageFake().storage,
      fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    });

    expect(url).toBe(CDN_META);
  });

  it("arquivo vazio não vira link — seria uma imagem quebrada no WhatsApp", async () => {
    const url = await espelharMidiaDeTemplate(CDN_META, "org-1", {
      storage: storageFake().storage,
      fetchImpl: vi.fn().mockResolvedValue(respostaOk(0)),
    });

    expect(url).toBe(CDN_META);
  });
});

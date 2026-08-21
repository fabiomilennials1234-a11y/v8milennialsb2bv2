// @vitest-environment node
/**
 * O que pode ser enviado pelo Direct, e em que forma.
 *
 * ⚠️ O FORNECEDOR EXIGE URL PÚBLICA. O provider recusa arquivo embutido em
 * base64 com todas as letras ("o canal oficial exige URL pública"), então o
 * anexo sobe para o nosso storage ANTES e o que viaja é o endereço.
 *
 * Esta validação existe no servidor mesmo o front já validando: o `to`, o tipo e
 * a URL chegam do cliente, e uma URL apontando para dentro da rede é o vetor
 * clássico de SSRF — o fornecedor buscaria o arquivo por nós.
 */
import { describe, it, expect } from "vitest";

import { readSocialSendPayload } from "../../supabase/functions/_shared/notificame-social-send.ts";

describe("readSocialSendPayload — texto", () => {
  it("aceita texto simples", () => {
    const r = readSocialSendPayload({ text: "Fala Gipp" });

    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "text") expect(r.text).toBe("Fala Gipp");
  });

  it("recusa texto vazio", () => {
    expect(readSocialSendPayload({ text: "   " }).ok).toBe(false);
  });

  it("recusa corpo sem texto e sem mídia", () => {
    const r = readSocialSendPayload({});

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("empty_message");
  });
});

describe("readSocialSendPayload — mídia", () => {
  const midia = (over: Record<string, unknown> = {}) => ({
    media: { type: "image", url: "https://cdn.torquecrm.com.br/a.jpg", ...over },
  });

  it("aceita imagem com URL pública", () => {
    const r = readSocialSendPayload(midia());

    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "media") {
      expect(r.media.type).toBe("image");
      expect(r.media.file).toBe("https://cdn.torquecrm.com.br/a.jpg");
    }
  });

  it.each(["image", "video", "audio", "document"])("aceita o tipo %s", (tipo) => {
    expect(readSocialSendPayload(midia({ type: tipo })).ok).toBe(true);
  });

  it("recusa figurinha — o fornecedor não suporta", () => {
    const r = readSocialSendPayload(midia({ type: "sticker" }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("media_type_unsupported");
  });

  it("recusa tipo desconhecido em vez de adivinhar", () => {
    expect(readSocialSendPayload(midia({ type: "planilha" })).ok).toBe(false);
  });

  it.each([
    ["base64 embutido", "data:image/png;base64,iVBORw0KGgo="],
    ["blob do navegador", "blob:https://torquecrm.com.br/abc"],
    ["caminho relativo", "/uploads/a.jpg"],
    ["sem esquema", "cdn.torquecrm.com.br/a.jpg"],
  ])("recusa %s — o fornecedor precisa BUSCAR o arquivo", (_rot, url) => {
    const r = readSocialSendPayload(midia({ url }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("media_url_invalid");
  });

  it("recusa http sem TLS", () => {
    expect(readSocialSendPayload(midia({ url: "http://cdn.torquecrm.com.br/a.jpg" })).ok).toBe(false);
  });

  /**
   * SSRF: quem busca o arquivo é o FORNECEDOR, mas a URL é escolhida pelo
   * cliente. Endereço interno aqui vira uma sonda contra a rede de quem baixar.
   */
  it.each([
    "https://localhost/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://10.0.0.5/a.jpg",
    "https://192.168.1.10/a.jpg",
    "https://169.254.169.254/latest/meta-data/",
  ])("recusa endereço interno: %s", (url) => {
    const r = readSocialSendPayload(midia({ url }));

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("media_url_invalid");
  });

  it("carrega legenda e nome do arquivo quando vêm", () => {
    const r = readSocialSendPayload(midia({ type: "document", caption: "Tabela", filename: "t.pdf" }));

    expect(r.ok).toBe(true);
    if (r.ok && r.kind === "media") {
      expect(r.media.caption).toBe("Tabela");
      expect(r.media.filename).toBe("t.pdf");
    }
  });

  it("mídia tem precedência sobre texto — legenda não vira mensagem separada", () => {
    const r = readSocialSendPayload({ text: "Olha isso", ...midia({ caption: "Olha isso" }) });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe("media");
  });
});

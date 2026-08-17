// @vitest-environment node
/**
 * Classificação do anexo do Direct.
 *
 * O fornecedor só aceita quatro tipos — image, video, audio e document — e
 * recusa figurinha. O que o navegador entrega é um MIME, e MIME mente: arquivo
 * baixado de sistema legado chega como `application/octet-stream`, e a extensão
 * às vezes é a única pista.
 */
import { describe, it, expect } from "vitest";

import {
  classifyAttachment,
  SOCIAL_ATTACHMENT_MAX_MB,
} from "../../src/modules/communication/lib/social-attachment";

describe("classifyAttachment — o que o fornecedor entende", () => {
  it.each([
    ["image/jpeg", "foto.jpg", "image"],
    ["image/png", "print.png", "image"],
    ["video/mp4", "video.mp4", "video"],
    ["audio/mpeg", "audio.mp3", "audio"],
    ["audio/webm", "gravacao.webm", "audio"],
    ["application/pdf", "tabela.pdf", "document"],
  ])("%s ⇒ %s", (mime, nome, esperado) => {
    const r = classifyAttachment(mime, nome, 1024);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.type).toBe(esperado);
  });

  it("cai na EXTENSÃO quando o MIME é genérico", () => {
    // Sistema legado exporta tudo como octet-stream. Sem esta queda, a tabela de
    // preço em PDF do cliente seria recusada sem motivo visível.
    const r = classifyAttachment("application/octet-stream", "tabela.pdf", 2048);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.type).toBe("document");
  });

  it("recusa figurinha — o fornecedor não suporta", () => {
    const r = classifyAttachment("image/webp", "figura.webp", 1024, { sticker: true });

    expect(r.ok).toBe(false);
  });

  it("arquivo desconhecido vira documento, não recusa", () => {
    // Documento é o balde certo: o fornecedor aceita, e recusar um .xlsx do
    // cliente por não estar numa lista seria pior que mandá-lo como arquivo.
    const r = classifyAttachment("application/vnd.ms-excel", "precos.xlsx", 4096);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.type).toBe("document");
  });
});

describe("classifyAttachment — tamanho", () => {
  it("recusa acima do teto, e diz o limite", () => {
    const grande = SOCIAL_ATTACHMENT_MAX_MB * 1024 * 1024 + 1;
    const r = classifyAttachment("image/jpeg", "foto.jpg", grande);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(String(SOCIAL_ATTACHMENT_MAX_MB));
  });

  it("recusa arquivo vazio", () => {
    expect(classifyAttachment("image/jpeg", "vazio.jpg", 0).ok).toBe(false);
  });

  it("aceita exatamente no teto", () => {
    const noLimite = SOCIAL_ATTACHMENT_MAX_MB * 1024 * 1024;

    expect(classifyAttachment("image/jpeg", "foto.jpg", noLimite).ok).toBe(true);
  });
});

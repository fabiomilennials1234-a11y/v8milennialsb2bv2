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
  audioExtensionForMime,
  classifyAttachment,
  pickAudioRecordingMime,
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

/**
 * O FORMATO DA GRAVAÇÃO.
 *
 * O gravador nascia com `new MediaRecorder(stream)` — default do navegador, que
 * no Chrome é `audio/webm;codecs=opus`. A Meta documenta, para áudio no
 * Instagram, `aac, m4a, wav, mp4`: **webm não está na lista**. Gravar no default
 * era escolher justamente o formato que o destino não lista.
 *
 * O segundo defeito era mais silencioso: o arquivo saía chamado `.webm` FIXO,
 * qualquer que fosse o `mimeType` real — no Safari, um mp4 com nome de webm. E
 * `classifyAttachment` cai para a extensão quando o MIME é genérico, então uma
 * extensão que mente é exatamente onde ele erra.
 */
describe("pickAudioRecordingMime — preferir o que o destino aceita", () => {
  /**
   * ⚠️ CONTRATO REVISTO em 2026-08-19: o mp4 agora é pedido COM O CODEC.
   *
   * `audio/mp4` cru não pede AAC — pede "mp4 com o que o navegador quiser
   * dentro", e o Chromium põe Opus. A Meta recusou o arquivo resultante com
   * `131053 ... on processing it is of type application/octet-stream`.
   *
   * Este teste segue medindo a MESMA coisa (a preferência do Instagram por
   * mp4/aac); mudou só a forma de pedi-la.
   */
  it("escolhe mp4 com codec AAC explícito quando o navegador suporta", () => {
    expect(pickAudioRecordingMime(() => true)).toBe("audio/mp4;codecs=mp4a.40.2");
  });

  it("cai para ogg quando só ogg e webm existem", () => {
    const suporta = (m: string) => m.startsWith("audio/ogg") || m.startsWith("audio/webm");
    expect(pickAudioRecordingMime(suporta)).toBe("audio/ogg;codecs=opus");
  });

  it("webm é último recurso, não o primeiro", () => {
    const suporta = (m: string) => m.startsWith("audio/webm");
    expect(pickAudioRecordingMime(suporta)).toBe("audio/webm;codecs=opus");
  });

  it("devolve undefined quando nada serve — o chamador deixa o navegador decidir", () => {
    expect(pickAudioRecordingMime(() => false)).toBeUndefined();
  });

  it("predicado que explode não derruba a escolha", () => {
    const suporta = (m: string) => {
      if (m === "audio/mp4") throw new TypeError("não implementado");
      return m.startsWith("audio/webm");
    };
    expect(pickAudioRecordingMime(suporta)).toBe("audio/webm;codecs=opus");
  });
});

describe("audioExtensionForMime — a extensão segue o conteúdo", () => {
  it.each([
    ["audio/mp4", "m4a"],
    ["audio/mp4;codecs=mp4a.40.2", "m4a"],
    ["audio/aac", "aac"],
    ["audio/mpeg", "mp3"],
    ["audio/ogg;codecs=opus", "ogg"],
    ["audio/wav", "wav"],
    ["audio/webm;codecs=opus", "webm"],
  ])("%s → .%s", (mime, ext) => {
    expect(audioExtensionForMime(mime)).toBe(ext);
  });

  it("desconhecido cai em m4a, não em webm — o default tem que ser o aceito", () => {
    expect(audioExtensionForMime("")).toBe("m4a");
    expect(audioExtensionForMime("application/octet-stream")).toBe("m4a");
  });

  it("a extensão escolhida sobrevive ao classificador como ÁUDIO", () => {
    // O elo que faltava: nome coerente + MIME genérico ainda classifica certo.
    const ext = audioExtensionForMime("audio/mp4");
    expect(classifyAttachment("application/octet-stream", `audio-1.${ext}`, 35072))
      .toEqual({ ok: true, type: "audio" });
  });
});

describe("documento — existe no WhatsApp, não no Direct", () => {
  it("recusa PDF quando o canal não aceita documento", () => {
    expect(classifyAttachment("application/pdf", "tabela.pdf", 1024, { allowDocument: false }))
      .toEqual({ ok: false, error: "O Direct não aceita documentos — mande imagem, vídeo ou áudio" });
  });

  it("recusa também o DESCONHECIDO, que caía em document por padrão", () => {
    const r = classifyAttachment("application/octet-stream", "coisa.xyz", 1024, {
      allowDocument: false,
    });
    expect(r.ok).toBe(false);
  });

  it("imagem, vídeo e áudio seguem passando no mesmo canal", () => {
    const o = { allowDocument: false };
    expect(classifyAttachment("image/jpeg", "f.jpg", 10, o)).toEqual({ ok: true, type: "image" });
    expect(classifyAttachment("video/mp4", "v.mp4", 10, o)).toEqual({ ok: true, type: "video" });
    expect(classifyAttachment("audio/mp4", "a.m4a", 10, o)).toEqual({ ok: true, type: "audio" });
  });

  it("sem a opção, o comportamento antigo continua — o WhatsApp depende dele", () => {
    expect(classifyAttachment("application/pdf", "tabela.pdf", 1024))
      .toEqual({ ok: true, type: "document" });
  });
});

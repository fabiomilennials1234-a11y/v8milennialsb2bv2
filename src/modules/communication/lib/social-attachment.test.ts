import { describe, expect, it } from "vitest";

import {
  classifyAttachment,
  isVoiceNoteMime,
  pickAudioRecordingMime,
} from "./social-attachment";

/**
 * A GRAVAÇÃO POR CANAL — o defeito 131053.
 *
 * Em 2026-08-19 a Meta recusou um áudio da Chique com
 *   "Audio file uploaded with mimetype as audio/mp4, however on processing it is
 *    of type application/octet-stream"
 * e o `ffprobe` sobre os bytes provou por quê: container MP4 com codec **Opus**.
 * Pedir `audio/mp4` sem codec não pede AAC — pede "mp4 com o que o navegador
 * quiser dentro".
 */
describe("pickAudioRecordingMime — por canal de destino", () => {
  const suporta = (...aceitos: string[]) => (m: string) => aceitos.includes(m);

  it("WhatsApp prefere ogg/opus — o único formato que a Meta aceita como nota de voz", () => {
    expect(
      pickAudioRecordingMime(
        suporta("audio/ogg;codecs=opus", "audio/mp4", "audio/webm"),
        "whatsapp_oficial",
      ),
    ).toBe("audio/ogg;codecs=opus");
  });

  it("sem ogg, o WhatsApp pede mp4 com CODEC EXPLÍCITO (AAC), nunca mp4 cru", () => {
    const escolhido = pickAudioRecordingMime(
      suporta("audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus"),
      "whatsapp_oficial",
    );

    expect(escolhido).toBe("audio/mp4;codecs=mp4a.40.2");
    // `audio/mp4` cru é exatamente o pedido que produziu MP4 com Opus dentro.
    expect(escolhido).not.toBe("audio/mp4");
  });

  it("o WhatsApp NUNCA grava webm — não está em lista nenhuma da Meta", () => {
    expect(
      pickAudioRecordingMime(suporta("audio/webm;codecs=opus", "audio/webm"), "whatsapp_oficial"),
    ).toBeUndefined();
  });

  it("Instagram mantém o comportamento dele, sem contaminar o WhatsApp", () => {
    expect(
      pickAudioRecordingMime(suporta("audio/webm;codecs=opus"), "instagram"),
    ).toBe("audio/webm;codecs=opus");
  });
});

describe("isVoiceNoteMime", () => {
  it("só ogg com opus é nota de voz", () => {
    expect(isVoiceNoteMime("audio/ogg;codecs=opus")).toBe(true);
    expect(isVoiceNoteMime("AUDIO/OGG; CODECS=OPUS")).toBe(true);
  });

  it("m4a NÃO é — foi a promessa que a Meta recusou com 131053", () => {
    expect(isVoiceNoteMime("audio/mp4")).toBe(false);
    expect(isVoiceNoteMime("audio/mp4;codecs=mp4a.40.2")).toBe(false);
  });

  it("ogg sem opus não é — a doc diz 'base audio/ogg not supported'", () => {
    expect(isVoiceNoteMime("audio/ogg")).toBe(false);
  });

  it("ausência de mime não é nota de voz", () => {
    expect(isVoiceNoteMime(null)).toBe(false);
    expect(isVoiceNoteMime(undefined)).toBe(false);
  });
});

/**
 * OS LIMITES DA META, aplicados ANTES do upload.
 *
 * O teto único de 16 MB e o `image/*` aberto foram calibrados para o Direct. No
 * canal oficial, a Cloud API aceita imagem só em JPEG/PNG e até 5 MB — mandar um
 * `.webp` repetiria o sumiço silencioso do áudio de 19/08: nós aceitamos, o
 * fornecedor aceita, a Meta recusa por callback, e a tela diz "enviado".
 */
describe("classifyAttachment — limites do canal oficial", () => {
  const MB = 1024 * 1024;
  const oficial = { canal: "whatsapp_oficial" as const, allowDocument: true };

  it("JPEG dentro de 5 MB passa", () => {
    expect(classifyAttachment("image/jpeg", "foto.jpg", 2 * MB, oficial)).toEqual({
      ok: true,
      type: "image",
    });
  });

  it("WEBP é recusado com a razão na tela, antes de subir", () => {
    const r = classifyAttachment("image/webp", "foto.webp", 1 * MB, oficial);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/JPEG ou PNG/);
  });

  it("JPEG de 8 MB é recusado — o teto da Meta para imagem é 5 MB", () => {
    const r = classifyAttachment("image/jpeg", "grande.jpg", 8 * MB, oficial);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/5 MB/);
  });

  it("vídeo fora de MP4/3GPP é recusado", () => {
    expect(classifyAttachment("video/quicktime", "v.mov", 3 * MB, oficial).ok).toBe(false);
    expect(classifyAttachment("video/mp4", "v.mp4", 3 * MB, oficial)).toEqual({
      ok: true,
      type: "video",
    });
  });

  it("documento é ACEITO no oficial — o WhatsApp tem documento, o Direct não", () => {
    expect(
      classifyAttachment("application/pdf", "tabela.pdf", 2 * MB, oficial),
    ).toEqual({ ok: true, type: "document" });

    const noDirect = classifyAttachment("application/pdf", "tabela.pdf", 2 * MB, {
      canal: "instagram",
      allowDocument: false,
    });
    expect(noDirect.ok).toBe(false);
  });

  it("o Direct não muda: WEBP e 8 MB continuam passando lá", () => {
    expect(classifyAttachment("image/webp", "foto.webp", 8 * MB, { canal: "instagram" })).toEqual({
      ok: true,
      type: "image",
    });
  });
});

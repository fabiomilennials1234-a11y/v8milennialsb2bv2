import { describe, expect, it } from "vitest";

import {
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

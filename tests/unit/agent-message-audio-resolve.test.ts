// @vitest-environment node
/**
 * Unit tests for resolveMediaContent — processes media via OpenRouter.
 *
 * Verifies:
 * 1. Audio message → downloads, sends to OpenRouter, returns transcription
 * 2. Text message → returns content as-is, no API call
 * 3. Audio with no media_url → returns fallback placeholder
 * 4. Transcription failure → returns fallback placeholder
 * 5. Image message → returns description from OpenRouter
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const envStub: Record<string, string> = {
  OPENROUTER_API_KEY: "test-or-key",
  OPENROUTER_REFERER_URL: "https://torquecrm.com.br",
};

vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => envStub[k] ?? undefined,
  },
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_name: string, fn: unknown) => fn,
  captureMessage: vi.fn(async () => {}),
  captureError: vi.fn(async () => {}),
}));

const { resolveMediaContent } = await import(
  "../../supabase/functions/_shared/audio-transcription.ts"
);

function openRouterResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  };
}

describe("resolveMediaContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns text content as-is for text messages", async () => {
    const result = await resolveMediaContent({
      content: "Olá, bom dia",
      messageType: "text",
      mediaUrl: null,
    });
    expect(result).toBe("Olá, bom dia");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("transcribes audio when content is null", async () => {
    // First fetch: download audio
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "audio/ogg" }),
      arrayBuffer: async () => new Uint8Array([0x4f, 0x67, 0x67, 0x53]).buffer,
    });
    // Second fetch: OpenRouter transcription
    mockFetch.mockResolvedValueOnce(openRouterResponse("Boa noite, quero informações"));

    const result = await resolveMediaContent({
      content: null,
      messageType: "audio",
      mediaUrl: "https://cdn.whatsapp.net/audio.ogg",
    });

    expect(result).toBe("[Áudio transcrito]: Boa noite, quero informações");
  });

  it("transcribes ptt (voice note) same as audio", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "audio/ogg" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    mockFetch.mockResolvedValueOnce(openRouterResponse("Me liga amanhã"));

    const result = await resolveMediaContent({
      content: null,
      messageType: "ptt",
      mediaUrl: "https://cdn.whatsapp.net/voice.ogg",
    });

    expect(result).toBe("[Áudio transcrito]: Me liga amanhã");
  });

  it("returns fallback when media_url is missing", async () => {
    const result = await resolveMediaContent({
      content: null,
      messageType: "audio",
      mediaUrl: null,
    });
    expect(result).toContain("[");
    expect(result).toContain("áudio");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns fallback when transcription fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "audio/ogg" }),
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "error",
    });

    const result = await resolveMediaContent({
      content: null,
      messageType: "audio",
      mediaUrl: "https://cdn.whatsapp.net/audio.ogg",
    });
    expect(result).toContain("[");
    expect(result).toContain("áudio");
  });

  it("describes image via OpenRouter", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg" }),
      arrayBuffer: async () => new Uint8Array([0xff, 0xd8]).buffer,
    });
    mockFetch.mockResolvedValueOnce(openRouterResponse("Uma foto de um produto industrial"));

    const result = await resolveMediaContent({
      content: null,
      messageType: "image",
      mediaUrl: "https://cdn.whatsapp.net/img.jpg",
    });
    expect(result).toBe("[Imagem recebida]: Uma foto de um produto industrial");
  });

  it("extracts PDF document content via OpenRouter file part", async () => {
    // First fetch: download the PDF
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer, // %PDF
    });
    // Second fetch: OpenRouter extraction
    mockFetch.mockResolvedValueOnce(
      openRouterResponse("CNPJ 44.388.011/0001-48 — TATI&NE HAMBURGUERIA LTDA"),
    );

    const result = await resolveMediaContent({
      content: null,
      messageType: "document",
      mediaUrl: "https://cdn.whatsapp.net/doc.pdf",
    });

    expect(result).toBe(
      "[documento]: CNPJ 44.388.011/0001-48 — TATI&NE HAMBURGUERIA LTDA",
    );

    // PDF must be sent as a `file` content part (NOT image_url) so the parser runs
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    const parts = body.messages[0].content;
    const filePart = parts.find((p: any) => p.type === "file");
    expect(filePart).toBeTruthy();
    expect(filePart.file.file_data).toContain("data:application/pdf;base64,");
    expect(parts.some((p: any) => p.type === "image_url")).toBe(false);
    // file-parser plugin enables PDF parsing on any model
    expect(body.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "file-parser" }),
      ]),
    );
  });

  it("returns document fallback when extraction fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
    });
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "error",
    });

    const result = await resolveMediaContent({
      content: null,
      messageType: "document",
      mediaUrl: "https://cdn.whatsapp.net/doc.pdf",
    });
    expect(result).toContain("[");
    expect(result).toContain("documento");
  });

  it("returns content when text message has content even with media_url", async () => {
    const result = await resolveMediaContent({
      content: "Foto do produto",
      messageType: "image",
      mediaUrl: "https://cdn.whatsapp.net/img.jpg",
    });
    expect(result).toContain("Foto do produto");
  });
});

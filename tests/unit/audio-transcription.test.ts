// @vitest-environment node
/**
 * Unit tests for audio-transcription — media understanding.
 *
 * Verifies the FIX (2026-06-22): audio is sent to OpenRouter via the correct
 * `input_audio` content part (raw base64 + format), NOT `image_url`. Plus
 * Gemini-direct fallback when OpenRouter fails, and graceful null on errors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const envStub: Record<string, string> = {
  OPENROUTER_API_KEY: "test-or-key",
  OPENROUTER_REFERER_URL: "https://torquecrm.com.br",
  // GEMINI_API_KEY intentionally absent → fallback no-ops in most tests
};

vi.stubGlobal("Deno", {
  env: { get: (k: string) => envStub[k] ?? undefined },
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { transcribeAudio } = await import(
  "../../supabase/functions/_shared/audio-transcription.ts"
);

const okResponse = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

describe("transcribeAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete envStub.GEMINI_API_KEY;
  });

  const fakeAudio = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // OGG magic bytes

  it("sends audio to OpenRouter as input_audio (NOT image_url) and returns text", async () => {
    mockFetch.mockResolvedValueOnce(okResponse("Olá, quero saber sobre os produtos."));

    const result = await transcribeAudio(fakeAudio, "audio/ogg");

    expect(result).toBe("Olá, quero saber sobre os produtos.");
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("openrouter.ai");
    expect(url).toContain("chat/completions");

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("google/gemini-2.5-flash");

    const content = body.messages[0].content;
    const audioPart = content.find((p: any) => p.type === "input_audio");
    expect(audioPart).toBeTruthy();
    expect(audioPart.input_audio.format).toBe("ogg");
    // data must be RAW base64, no data: URI prefix
    expect(audioPart.input_audio.data).not.toContain("data:");
    const decoded = Uint8Array.from(atob(audioPart.input_audio.data), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(fakeAudio);

    // must NOT use image_url for audio (the historical bug)
    expect(content.find((p: any) => p.type === "image_url")).toBeUndefined();
  });

  it("maps mp3 mime to format mp3", async () => {
    mockFetch.mockResolvedValueOnce(okResponse("texto"));
    await transcribeAudio(fakeAudio, "audio/mpeg");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const audioPart = body.messages[0].content.find((p: any) => p.type === "input_audio");
    expect(audioPart.input_audio.format).toBe("mp3");
  });

  it("falls back to Gemini direct when OpenRouter returns no text", async () => {
    envStub.GEMINI_API_KEY = "test-gemini-key";
    // 1st call: OpenRouter empty → 2nd call: Gemini direct returns text
    mockFetch
      .mockResolvedValueOnce(okResponse(""))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "transcrição via gemini" }] } }],
        }),
      });

    const result = await transcribeAudio(fakeAudio, "audio/ogg");
    expect(result).toBe("transcrição via gemini");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const geminiUrl = mockFetch.mock.calls[1][0];
    expect(geminiUrl).toContain("generativelanguage.googleapis.com");
    const geminiBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(geminiBody.contents[0].parts[0].inline_data.mime_type).toBe("audio/ogg");
  });

  it("returns null when both OpenRouter and Gemini fail (no gemini key)", async () => {
    // OpenRouter empty, no GEMINI_API_KEY → fallback no-ops
    mockFetch.mockResolvedValueOnce(okResponse(""));
    const result = await transcribeAudio(fakeAudio, "audio/ogg");
    expect(result).toBeNull();
  });

  it("returns null on API error without throwing", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const result = await transcribeAudio(fakeAudio, "audio/ogg");
    expect(result).toBeNull();
  });

  it("returns null on network failure without throwing", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    const result = await transcribeAudio(fakeAudio, "audio/ogg");
    expect(result).toBeNull();
  });

  it("sends Authorization header with OpenRouter API key", async () => {
    mockFetch.mockResolvedValueOnce(okResponse("test"));
    await transcribeAudio(fakeAudio, "audio/ogg");
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer test-or-key");
  });
});

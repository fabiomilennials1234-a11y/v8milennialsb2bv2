// @vitest-environment node
/**
 * Unit tests for audio-transcription — OpenRouter-based media understanding.
 *
 * Verifies:
 * 1. Sends audio bytes to OpenRouter (google/gemini-2.5-flash) and returns transcription
 * 2. Returns null when OpenRouter returns empty/no text
 * 3. Handles API errors gracefully (returns null, does not throw)
 * 4. Sends correct mimeType and base64 as data URI
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

const { transcribeAudio } = await import(
  "../../supabase/functions/_shared/audio-transcription.ts"
);

describe("transcribeAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fakeAudio = new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // OGG magic bytes

  it("sends audio to OpenRouter and returns transcription text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "Olá, boa noite! Quero saber sobre os produtos." } },
        ],
      }),
    });

    const result = await transcribeAudio(fakeAudio, "audio/ogg");

    expect(result).toBe("Olá, boa noite! Quero saber sobre os produtos.");
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("openrouter.ai");
    expect(url).toContain("chat/completions");

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("google/gemini-2.5-flash");

    const userContent = body.messages[0].content;
    expect(userContent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image_url",
          image_url: expect.objectContaining({
            url: expect.stringContaining("data:audio/ogg;base64,"),
          }),
        }),
        expect.objectContaining({ type: "text" }),
      ]),
    );
  });

  it("returns null when OpenRouter returns no text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "" } }],
      }),
    });

    const result = await transcribeAudio(fakeAudio, "audio/ogg");
    expect(result).toBeNull();
  });

  it("returns null on API error without throwing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await transcribeAudio(fakeAudio, "audio/ogg");
    expect(result).toBeNull();
  });

  it("returns null on network failure without throwing", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));

    const result = await transcribeAudio(fakeAudio, "audio/ogg");
    expect(result).toBeNull();
  });

  it("encodes audio bytes as base64 data URI in request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "test" } }],
      }),
    });

    await transcribeAudio(fakeAudio, "audio/ogg");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const imageUrlPart = body.messages[0].content.find(
      (p: any) => p.type === "image_url",
    );
    const dataUri = imageUrlPart.image_url.url;
    const base64 = dataUri.split(",")[1];
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(fakeAudio);
  });

  it("sends Authorization header with OpenRouter API key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "test" } }],
      }),
    });

    await transcribeAudio(fakeAudio, "audio/ogg");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer test-or-key");
  });
});

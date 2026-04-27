/**
 * Tests for tts-elevenlabs.ts — ElevenLabs TTS → Supabase Storage pipeline.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

const mockUpload = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: null, error: null }),
);
const mockGetPublicUrl = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    data: { publicUrl: "https://cdn.test/media/audio.mp3" },
  }),
);

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  }),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

import {
  truncateForTts,
  generateTtsAudio,
} from "../../supabase/functions/_shared/tts-elevenlabs";

beforeEach(() => {
  clearDenoEnv();
  setDenoEnv("SUPABASE_URL", "https://supabase.test");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.clearAllMocks();
  mockUpload.mockResolvedValue({ data: null, error: null });
  mockGetPublicUrl.mockReturnValue({
    data: { publicUrl: "https://cdn.test/media/audio.mp3" },
  });
});

// ─── truncateForTts ───────────────────────────────────────────────────────

describe("truncateForTts", () => {
  it("returns text unchanged when shorter than max", () => {
    expect(truncateForTts("hi", 100)).toBe("hi");
  });

  it("truncates at last sentence end (.)", () => {
    const text = "Sentence one. Sentence two. Sentence three and more text here";
    const result = truncateForTts(text, 30);
    expect(result).toMatch(/\.$/);
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it("truncates at last sentence end (!)", () => {
    const text = "Great news! Here is the detail that goes beyond the limit";
    expect(truncateForTts(text, 15)).toBe("Great news!");
  });

  it("truncates at last sentence end (?)", () => {
    const text = "Quer saber? Vou te explicar com calma agora muito detalhadamente";
    expect(truncateForTts(text, 15)).toBe("Quer saber?");
  });

  it("falls back to last space + '...' when no sentence boundary", () => {
    const text = "this is a very long sentence without terminal punctuation at all";
    const result = truncateForTts(text, 20);
    expect(result.endsWith("...")).toBe(true);
  });

  it("falls back to hard cut + '...' with no spaces either", () => {
    const text = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const result = truncateForTts(text, 10);
    expect(result.endsWith("...")).toBe(true);
  });

  it("uses hard cut when sentence end is in first 30% of text", () => {
    // Period very early → doesn't meet >maxChars*0.3 threshold → fallback
    const text = "A. then lots of filler content goes on and on without stop";
    const result = truncateForTts(text, 30);
    // Falls through to last space + "..."
    expect(result.endsWith("...")).toBe(true);
  });
});

// ─── generateTtsAudio ─────────────────────────────────────────────────────

const baseRequest = () => ({
  text: "Olá, tudo bem?",
  voiceId: "v-1",
  apiKey: "xi-key",
});

describe("generateTtsAudio — happy path", () => {
  it("uploads audio and returns public URL", async () => {
    const audioBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      blob: () =>
        Promise.resolve(new Blob([audioBuffer], { type: "audio/mpeg" })),
    });

    const result = await generateTtsAudio(baseRequest(), "org-1");
    expect(result.success).toBe(true);
    expect(result.audioUrl).toBe("https://cdn.test/media/audio.mp3");
    expect(result.charCount).toBe(14);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Upload called with path containing the orgId
    const uploadCall = mockUpload.mock.calls[0];
    expect(uploadCall[0]).toMatch(/tts-audio\/org-1\/.+\.mp3$/);
  });

  it("uses default model, stability, similarity when not provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob([new Uint8Array([1])])),
    });
    await generateTtsAudio(baseRequest(), "org-1");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model_id).toBe("eleven_multilingual_v2");
    expect(body.voice_settings.stability).toBe(0.5);
    expect(body.voice_settings.similarity_boost).toBe(0.75);
  });

  it("respects custom modelId / stability / similarityBoost / outputFormat", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob([new Uint8Array([1])])),
    });
    await generateTtsAudio(
      {
        ...baseRequest(),
        modelId: "eleven_flash_v2",
        stability: 0.9,
        similarityBoost: 0.2,
        outputFormat: "mp3_44100_64",
      },
      "org-1",
    );
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("output_format=mp3_44100_64");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model_id).toBe("eleven_flash_v2");
    expect(body.voice_settings.stability).toBe(0.9);
    expect(body.voice_settings.similarity_boost).toBe(0.2);
  });
});

// ─── Error paths ──────────────────────────────────────────────────────────

describe("generateTtsAudio — error paths", () => {
  it("returns error on ElevenLabs non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("rate limited"),
    });
    const result = await generateTtsAudio(baseRequest(), "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("429");
    expect(result.charCount).toBe(14);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("returns error when storage upload fails", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob([new Uint8Array([1])])),
    });
    mockUpload.mockResolvedValueOnce({
      data: null,
      error: { message: "bucket full" },
    });
    const result = await generateTtsAudio(baseRequest(), "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Storage upload");
  });

  it("catches thrown fetch errors", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    const result = await generateTtsAudio(baseRequest(), "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("network down");
  });

  it("reports timeout as AbortError", async () => {
    const abortErr = new DOMException("aborted", "AbortError");
    mockFetch.mockRejectedValue(abortErr);
    const result = await generateTtsAudio(baseRequest(), "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Timeout/);
  });

  it("handles non-Error thrown values", async () => {
    mockFetch.mockImplementation(() => {
      throw "string error";
    });
    const result = await generateTtsAudio(baseRequest(), "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("string error");
  });
});

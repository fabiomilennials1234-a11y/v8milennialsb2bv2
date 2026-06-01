/**
 * Tests for _shared/embeddings.ts — OpenRouter → Gemini Embedding 2 + RAG chunking.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

import {
  generateEmbedding,
  generateMultimodalEmbedding,
  generateEmbeddingsBatch,
  chunkText,
  formatEmbeddingForPg,
} from "../../supabase/functions/_shared/embeddings";

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

// ─── generateEmbedding ────────────────────────────────────────────────────

describe("generateEmbedding", () => {
  it("returns embedding values on success via OpenRouter", async () => {
    const vec = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [{ embedding: vec, index: 0 }] }),
      text: () => Promise.resolve(""),
    });
    const result = await generateEmbedding("olá mundo", "or-key");
    expect(result).toHaveLength(1536);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("openrouter.ai/api/v1/embeddings");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer or-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("google/gemini-embedding-2");
    expect(body.dimensions).toBe(1536);
    expect(body.input).toBe("olá mundo");
  });

  it("truncates text to 8000 chars", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.1], index: 0 }] }),
    });
    const long = "x".repeat(10_000);
    await generateEmbedding(long, "k");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.input.length).toBe(8000);
  });

  it("throws with status + body on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve("rate limited"),
    });
    await expect(generateEmbedding("x", "k")).rejects.toThrow(/429.*rate limited/);
  });
});

// ─── generateMultimodalEmbedding ──────────────────────────────────────────

describe("generateMultimodalEmbedding", () => {
  it("base64-encodes data as data URI and posts to OpenRouter", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.5], index: 0 }] }),
    });
    const data = new Uint8Array([65, 66, 67]); // "ABC"
    const result = await generateMultimodalEmbedding(data, "image/png", "k");
    expect(result).toEqual([0.5]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe("google/gemini-embedding-2");
    expect(body.input).toContain("data:image/png;base64,");
    expect(body.input).toContain(btoa("ABC"));
  });

  it("chunked encoding handles large buffers (>32KB)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.7], index: 0 }] }),
    });
    const big = new Uint8Array(100_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;

    const result = await generateMultimodalEmbedding(big, "audio/ogg", "k");
    expect(result).toEqual([0.7]);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 413,
      text: () => Promise.resolve("payload too large"),
    });
    await expect(
      generateMultimodalEmbedding(new Uint8Array([1]), "image/png", "k"),
    ).rejects.toThrow(/Multimodal.*413/);
  });
});

// ─── generateEmbeddingsBatch ──────────────────────────────────────────────

describe("generateEmbeddingsBatch", () => {
  it("returns embeddings in order for a single batch", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [
            { embedding: [1, 2], index: 0 },
            { embedding: [3, 4], index: 1 },
          ],
        }),
    });
    const result = await generateEmbeddingsBatch(["a", "b"], "k");
    expect(result).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.input).toHaveLength(2);
  });

  it("chunks into multiple HTTP calls when > BATCH_SIZE (100)", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      const batchSize = callCount <= 2 ? 100 : 50;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: Array.from({ length: batchSize }, (_, i) => ({
              embedding: [0],
              index: i,
            })),
          }),
      });
    });
    const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const result = await generateEmbeddingsBatch(texts, "k");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.length).toBe(250);
  });

  it("throws on batch API error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("boom"),
    });
    await expect(generateEmbeddingsBatch(["x"], "k")).rejects.toThrow(/batch.*500/);
  });

  it("returns empty array for empty input", async () => {
    const result = await generateEmbeddingsBatch([], "k");
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("truncates each text to 8000 chars", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0], index: 0 }] }),
    });
    await generateEmbeddingsBatch(["y".repeat(10_000)], "k");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.input[0].length).toBe(8000);
  });
});

// ─── chunkText ────────────────────────────────────────────────────────────

describe("chunkText", () => {
  it("returns [] for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns [cleaned] when shorter than chunkSize", () => {
    const result = chunkText("short text");
    expect(result).toEqual(["short text"]);
  });

  it("normalizes CRLF and collapses extra blank lines", () => {
    const result = chunkText("a\r\nb\n\n\n\nc");
    expect(result[0]).toBe("a\nb\n\nc");
  });

  it("splits by paragraphs when combined length exceeds chunkSize", () => {
    const para1 = "p1. " + "a".repeat(400);
    const para2 = "p2. " + "b".repeat(400);
    const para3 = "p3. " + "c".repeat(400);
    const text = [para1, para2, para3].join("\n\n");
    const chunks = chunkText(text, 500, 20);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("splits a single very long paragraph by sentences", () => {
    const sentences = Array.from({ length: 20 }, (_, i) =>
      `Sentence number ${i} with enough padding to reach reasonable length yes it is.`,
    );
    const paragraph = sentences.join(" ");
    const chunks = chunkText(paragraph, 300);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("filters out chunks shorter than 50 chars", () => {
    const text = "short.\n\n" + "x".repeat(2000);
    const chunks = chunkText(text, 500);
    for (const c of chunks) expect(c.length).toBeGreaterThan(50);
  });
});

// ─── formatEmbeddingForPg ─────────────────────────────────────────────────

describe("formatEmbeddingForPg", () => {
  it("formats vector as Postgres array literal", () => {
    expect(formatEmbeddingForPg([1, 2, 3])).toBe("[1,2,3]");
  });

  it("handles empty vector", () => {
    expect(formatEmbeddingForPg([])).toBe("[]");
  });

  it("preserves floating-point values", () => {
    expect(formatEmbeddingForPg([0.5, -0.25, 1e-6])).toBe("[0.5,-0.25,0.000001]");
  });
});

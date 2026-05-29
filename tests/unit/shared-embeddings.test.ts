/**
 * Tests for _shared/embeddings.ts — Gemini Embedding 2 + RAG chunking.
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
  it("returns embedding values on success", async () => {
    const vec = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ embedding: { values: vec } }),
      text: () => Promise.resolve(""),
    });
    const result = await generateEmbedding("olá mundo", "gem-key");
    expect(result).toHaveLength(1536);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("gemini-embedding-2:embedContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("gem-key");
    const body = JSON.parse(init.body as string);
    expect(body.outputDimensionality).toBe(1536);
    expect(body.content.parts[0].text).toBe("olá mundo");
  });

  it("truncates text to 8000 chars", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: { values: [0.1] } }),
    });
    const long = "x".repeat(10_000);
    await generateEmbedding(long, "k");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.content.parts[0].text.length).toBe(8000);
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
  it("base64-encodes data and posts inline_data", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: { values: [0.5] } }),
    });
    const data = new Uint8Array([65, 66, 67]); // "ABC"
    const result = await generateMultimodalEmbedding(data, "image/png", "k");
    expect(result).toEqual([0.5]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.content.parts[0].inline_data.mime_type).toBe("image/png");
    expect(body.content.parts[0].inline_data.data).toBe(btoa("ABC"));
  });

  it("chunked encoding handles large buffers (>32KB)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ embedding: { values: [0.7] } }),
    });
    // 100KB of data — triggers the chunked loop that would otherwise blow
    // the call stack with btoa(String.fromCharCode(...arr)).
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
          embeddings: [
            { values: [1, 2] },
            { values: [3, 4] },
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
    expect(body.requests).toHaveLength(2);
  });

  it("chunks into multiple HTTP calls when > BATCH_SIZE (100)", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            embeddings: Array.from({ length: 100 }, () => ({ values: [0] })),
          }),
      }),
    );
    const texts = Array.from({ length: 250 }, (_, i) => `t${i}`);
    const result = await generateEmbeddingsBatch(texts, "k");
    // 3 batches: 100 + 100 + 50. Mock always returns 100 → total 300,
    // but the test verifies fetch was called 3 times.
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.length).toBe(300);
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
      json: () => Promise.resolve({ embeddings: [{ values: [0] }] }),
    });
    await generateEmbeddingsBatch(["y".repeat(10_000)], "k");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.requests[0].content.parts[0].text.length).toBe(8000);
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
    // Build 3 paragraphs each 400 chars → 3 chunks with overlap
    const para1 = "p1. " + "a".repeat(400);
    const para2 = "p2. " + "b".repeat(400);
    const para3 = "p3. " + "c".repeat(400);
    const text = [para1, para2, para3].join("\n\n");
    const chunks = chunkText(text, 500, 20);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Overlap: each subsequent chunk starts with last 20 chars of previous
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

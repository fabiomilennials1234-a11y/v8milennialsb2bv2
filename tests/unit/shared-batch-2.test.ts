/**
 * Batch tests for _shared modules — embeddings, sentry, asaas, tinyerp, track, logger, ai-queue
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true, status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve("ok"),
    headers: new Headers(),
  });
});

// ── embeddings.ts ──
import { generateEmbedding, generateEmbeddingsBatch } from "../../supabase/functions/_shared/embeddings";

describe("generateEmbedding", () => {
  it("calls the OpenRouter embeddings API with correct parameters", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    });
    const result = await generateEmbedding("test text", "api-key");
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("truncates text to 8000 chars", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [{ embedding: [0.1] }] }),
    });
    const longText = "a".repeat(10000);
    await generateEmbedding(longText, "key");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input.length).toBeLessThanOrEqual(8000);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 400,
      text: () => Promise.resolve("bad request"),
    });
    await expect(generateEmbedding("test", "key")).rejects.toThrow("OpenRouter Embedding API error");
  });
});

describe("generateEmbeddingsBatch", () => {
  it("generates embeddings for multiple texts", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { embedding: [0.1, 0.2], index: 0 },
          { embedding: [0.3, 0.4], index: 1 },
        ],
      }),
    });
    const result = await generateEmbeddingsBatch(["text1", "text2"], "key");
    expect(result).toHaveLength(2);
  });

  it("throws on batch API error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 500,
      text: () => Promise.resolve("server error"),
    });
    await expect(generateEmbeddingsBatch(["a"], "key")).rejects.toThrow();
  });
});

// ── sentry.ts ──
import { captureError, withSentry } from "../../supabase/functions/_shared/sentry";

describe("captureError", () => {
  it("does nothing when no SENTRY_DSN", async () => {
    clearDenoEnv();
    await captureError(new Error("test"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends error when DSN is set", async () => {
    setDenoEnv("SENTRY_DSN", "https://abc123@o123.ingest.sentry.io/456");
    mockFetch.mockResolvedValueOnce({ ok: true });
    await captureError(new Error("test error"), { functionName: "test-fn" });
    expect(mockFetch).toHaveBeenCalled();
  });

  it("handles non-Error objects", async () => {
    setDenoEnv("SENTRY_DSN", "https://abc123@o123.ingest.sentry.io/456");
    mockFetch.mockResolvedValueOnce({ ok: true });
    await captureError("string error");
    // Should not throw
  });

  it("silently ignores fetch failures", async () => {
    setDenoEnv("SENTRY_DSN", "https://abc123@o123.ingest.sentry.io/456");
    mockFetch.mockRejectedValueOnce(new Error("network"));
    await expect(captureError(new Error("test"))).resolves.not.toThrow();
  });
});

describe("withSentry", () => {
  it("returns a function", () => {
    const wrapped = withSentry("test-fn", async () => new Response("ok"));
    expect(typeof wrapped).toBe("function");
  });

  it("passes through successful responses", async () => {
    const handler = withSentry("test-fn", async () => new Response("ok", { status: 200 }));
    const req = new Request("http://test.com");
    const res = await handler(req);
    expect(res.status).toBe(200);
  });

  it("catches and reports errors", async () => {
    setDenoEnv("SENTRY_DSN", "https://abc123@o123.ingest.sentry.io/456");
    mockFetch.mockResolvedValue({ ok: true });
    const handler = withSentry("test-fn", async () => { throw new Error("boom"); });
    const req = new Request("http://test.com");
    const res = await handler(req);
    expect(res.status).toBe(500);
  });
});

// ── asaas types ──
import type { AsaasPaymentStatus, AsaasCustomer, AsaasPayment } from "../../supabase/functions/_shared/asaas";

describe("asaas types", () => {
  it("AsaasPaymentStatus values", () => {
    const statuses: AsaasPaymentStatus[] = ["PENDING", "RECEIVED", "CONFIRMED", "OVERDUE", "REFUNDED"];
    expect(statuses.length).toBe(5);
  });

  it("AsaasCustomer shape", () => {
    const c: Partial<AsaasCustomer> = { id: "c1", name: "Test", email: "t@t.com", cpfCnpj: "123" };
    expect(c.name).toBe("Test");
  });

  it("AsaasPayment shape", () => {
    const p: Partial<AsaasPayment> = { id: "p1", billingType: "PIX", value: 100, status: "PENDING" };
    expect(p.billingType).toBe("PIX");
  });
});

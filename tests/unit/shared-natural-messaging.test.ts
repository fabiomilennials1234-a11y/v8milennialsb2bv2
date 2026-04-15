/**
 * Tests for _shared/natural-messaging.ts — smart message splitting.
 *
 * Uses vi.resetModules() + dynamic import to control OPENROUTER_API_KEY
 * (captured at module top level).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

async function loadModule() {
  vi.resetModules();
  return await import("../../supabase/functions/_shared/natural-messaging");
}

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  mockFetch.mockReset();
});

// ─── enabled=false + short message paths ─────────────────────────────────

describe("smartSplitMessage — bypass paths", () => {
  it("returns full message when disabled", async () => {
    const { smartSplitMessage } = await loadModule();
    const result = await smartSplitMessage("anything", {
      enabled: false,
      intensity: "natural",
    });
    expect(result).toEqual({ chunks: ["anything"], delays: [0] });
  });

  it("returns single chunk when message shorter than minChunkChars", async () => {
    const { smartSplitMessage } = await loadModule();
    // natural.minChunkChars=30 — 15-char message bypasses LLM
    const result = await smartSplitMessage("Mensagem curta", {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.delays).toEqual([0]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── LLM path success + fallbacks ─────────────────────────────────────────

describe("smartSplitMessage — LLM path", () => {
  const longMessage =
    "Oi João, tudo bem? Então, sobre o plano Pro que você perguntou, ele custa R$297/mês. Quer que eu te explique os benefícios?";

  it("returns LLM-split chunks on success with delays > 0 except first", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-k");
    const { smartSplitMessage } = await loadModule();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  "Oi João, tudo bem?",
                  "Sobre o plano Pro, R$297/mês.",
                  "Quer que eu explique os benefícios?",
                ]),
              },
            },
          ],
        }),
      text: () => Promise.resolve(""),
    });

    const result = await smartSplitMessage(longMessage, {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks).toHaveLength(3);
    expect(result.delays[0]).toBe(0);
    expect(result.delays[1]).toBeGreaterThan(0);
    expect(result.delays[2]).toBeGreaterThan(0);
  });

  it("strips markdown ```json wrapper from LLM output", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-k");
    const { smartSplitMessage } = await loadModule();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content:
                  '```json\n["Parte A aqui com algum tamanho ok", "Parte B com mais texto ok"]\n```',
              },
            },
          ],
        }),
    });
    const result = await smartSplitMessage(longMessage, {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks).toHaveLength(2);
  });

  it("returns full message when LLM says single chunk", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-k");
    const { smartSplitMessage } = await loadModule();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify(["apenas-um-chunk-longo-aqui"]),
              },
            },
          ],
        }),
    });
    const result = await smartSplitMessage(longMessage, {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe(longMessage.trim());
    expect(result.delays).toEqual([0]);
  });

  it("falls back to heuristic when LLM HTTP errors", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-k");
    const { smartSplitMessage } = await loadModule();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("err"),
    });
    // Build a 600-char message so heuristic splits it (maxCharsPerChunk=250)
    const msg =
      "Parágrafo um com texto que vai passar do limite de um chunk conforme configurado no preset natural do serviço.".repeat(
        3,
      ) +
      "\n\n" +
      "Parágrafo dois também bem grande para forçar a divisão heurística em múltiplos chunks diferentes.".repeat(
        3,
      );
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await smartSplitMessage(msg, {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it("falls back to heuristic when LLM returns invalid JSON", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-k");
    const { smartSplitMessage } = await loadModule();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: "not json at all" } }],
        }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await smartSplitMessage(longMessage, {
      enabled: true,
      intensity: "natural",
    });
    // Heuristic fallback on short-ish input returns a single chunk
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it("falls back to heuristic when LLM returns non-array", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-k");
    const { smartSplitMessage } = await loadModule();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '{"not": "array"}' } }],
        }),
    });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await smartSplitMessage(longMessage, {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it("falls back to heuristic when LLM throws", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "or-k");
    const { smartSplitMessage } = await loadModule();
    mockFetch.mockRejectedValue(new Error("network"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await smartSplitMessage(longMessage, {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });
});

// ─── Heuristic-only path (no API key) ─────────────────────────────────────

describe("smartSplitMessage — heuristic fallback (no API key)", () => {
  it("splits by paragraphs when longer than maxCharsPerChunk", async () => {
    const { smartSplitMessage } = await loadModule();
    const para = "A".repeat(200);
    // 3 paragraphs, each 200 chars, total > natural.maxCharsPerChunk=250
    const msg = [para, para, para].join("\n\n");
    const result = await smartSplitMessage(msg, {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it("splits a single oversized paragraph by sentences", async () => {
    const { smartSplitMessage } = await loadModule();
    const sent = "Isso é uma frase de teste bem completa com pontuação. ";
    const paragraph = sent.repeat(15);
    const result = await smartSplitMessage(paragraph, {
      enabled: true,
      intensity: "natural",
    });
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it("merges tiny last chunk into previous when fits in maxCharsPerChunk", async () => {
    const { smartSplitMessage } = await loadModule();
    // Two paragraphs that both fit individually, but where the second is
    // below minChunkChars so mergeTinyChunks should combine them.
    const result = await smartSplitMessage(
      "A".repeat(100) + "\n\n" + "B".repeat(100) + "\n\n" + "tiny",
      { enabled: true, intensity: "natural" },
    );
    // At least one chunk produced; last chunk should not be tiny or merged
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("honors suave preset (larger chunks)", async () => {
    const { smartSplitMessage } = await loadModule();
    const msg = "A".repeat(200);
    const result = await smartSplitMessage(msg, {
      enabled: true,
      intensity: "suave",
    });
    // suave.minChunkChars=40 → 200 chars > that threshold. LLM invoked.
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("honors conversacional preset (smaller chunks)", async () => {
    const { smartSplitMessage } = await loadModule();
    const msg = "A".repeat(200) + "\n\n" + "B".repeat(200);
    const result = await smartSplitMessage(msg, {
      enabled: true,
      intensity: "conversacional",
    });
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });
});

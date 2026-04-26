/**
 * Tests for prompt-builder + llm-client helpers (pure utilities).
 */

import { describe, it, expect } from "vitest";
import "../../helpers/deno-mock";
import {
  estimateTokens,
  isPromptWithinLimit,
  MAX_PROMPT_TOKENS,
} from "../../../supabase/functions/_shared/copilot/prompt-builder.ts";
import {
  startTimer,
  extractTokenUsage,
  withTimeout,
  LLM_DEFAULT_TIMEOUT_MS,
} from "../../../supabase/functions/_shared/copilot/llm-client.ts";

describe("estimateTokens", () => {
  it("aproxima 1 token ≈ 4 chars", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("arredonda pra cima (Math.ceil)", () => {
    expect(estimateTokens("abc")).toBe(1); // 3/4 = 0.75 → 1
    expect(estimateTokens("a")).toBe(1);
  });

  it("string longa", () => {
    const text = "x".repeat(8000);
    expect(estimateTokens(text)).toBe(2000);
  });
});

describe("isPromptWithinLimit", () => {
  it("string vazia OK", () => {
    expect(isPromptWithinLimit("")).toBe(true);
  });

  it("dentro do default MAX_PROMPT_TOKENS", () => {
    const safe = "x".repeat(MAX_PROMPT_TOKENS * 4 - 100);
    expect(isPromptWithinLimit(safe)).toBe(true);
  });

  it("acima do limite default", () => {
    const oversized = "x".repeat(MAX_PROMPT_TOKENS * 4 + 100);
    expect(isPromptWithinLimit(oversized)).toBe(false);
  });

  it("limite custom respeitado", () => {
    expect(isPromptWithinLimit("x".repeat(40), 10)).toBe(true); // 10 tokens
    expect(isPromptWithinLimit("x".repeat(44), 10)).toBe(false); // 11 tokens
  });
});

describe("startTimer", () => {
  it("retorna função elapsed que mede ms", async () => {
    const t = startTimer();
    await new Promise((r) => setTimeout(r, 25));
    const elapsed = t.elapsed();
    expect(elapsed).toBeGreaterThanOrEqual(20);
    expect(elapsed).toBeLessThan(200);
  });

  it("elapsed pode ser chamado múltiplas vezes", async () => {
    const t = startTimer();
    const a = t.elapsed();
    await new Promise((r) => setTimeout(r, 10));
    const b = t.elapsed();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe("extractTokenUsage", () => {
  it("extrai shape OpenRouter válido", () => {
    const r = { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    expect(extractTokenUsage(r)).toEqual({ prompt: 100, completion: 50, total: 150 });
  });

  it("calcula total se ausente", () => {
    const r = { usage: { prompt_tokens: 100, completion_tokens: 50 } };
    expect(extractTokenUsage(r)).toEqual({ prompt: 100, completion: 50, total: 150 });
  });

  it("retorna null se usage ausente", () => {
    expect(extractTokenUsage({})).toBeNull();
    expect(extractTokenUsage(null)).toBeNull();
  });

  it("retorna null se shape inválido (sem prompt_tokens number)", () => {
    expect(extractTokenUsage({ usage: { foo: "bar" } })).toBeNull();
    expect(extractTokenUsage({ usage: { prompt_tokens: "100" } })).toBeNull();
  });
});

describe("withTimeout", () => {
  it("resolve normal se promise termina antes do timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000);
    expect(result).toBe("ok");
  });

  it("rejeita com mensagem padrão se promise estoura timeout", async () => {
    const slow = new Promise((r) => setTimeout(r, 200));
    await expect(withTimeout(slow, 50)).rejects.toThrow(/timeout/i);
  });

  it("rejeita com mensagem custom", async () => {
    const slow = new Promise((r) => setTimeout(r, 200));
    await expect(withTimeout(slow, 50, "custom error")).rejects.toThrow("custom error after 50ms");
  });

  it("LLM_DEFAULT_TIMEOUT_MS = 30s", () => {
    expect(LLM_DEFAULT_TIMEOUT_MS).toBe(30_000);
  });
});

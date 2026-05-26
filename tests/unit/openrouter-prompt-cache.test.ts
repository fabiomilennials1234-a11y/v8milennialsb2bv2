/**
 * OpenRouter prompt caching — Anthropic cache headers.
 *
 * Verifica que requests pra modelos Anthropic incluem headers de cache
 * e que modelos não-Anthropic NÃO incluem.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenRouterClient } from "../../supabase/functions/agent-message/openrouter-client.ts";

let lastFetchCall: { url: string; init: RequestInit } | null = null;

const mockResponse = {
  ok: true,
  json: () => Promise.resolve({
    id: "test",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }),
};

beforeEach(() => {
  lastFetchCall = null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    lastFetchCall = { url, init };
    return mockResponse;
  });
  vi.stubGlobal("Deno", { env: { get: () => undefined } });
});

describe("Prompt caching — Anthropic models", () => {
  it("should include anthropic-beta cache header for Anthropic models", async () => {
    const client = new OpenRouterClient("test-key");
    await client.chat({
      model: "anthropic/claude-3.5-haiku",
      messages: [{ role: "system", content: "You are helpful" }],
    });

    const headers = lastFetchCall!.init.headers as Record<string, string>;
    expect(headers["anthropic-beta"]).toBe("prompt-caching-2024-07-31");
  });

  it("should NOT include anthropic-beta header for non-Anthropic models", async () => {
    const client = new OpenRouterClient("test-key");
    await client.chat({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: "You are helpful" }],
    });

    const headers = lastFetchCall!.init.headers as Record<string, string>;
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("should add cache_control to system message for Anthropic models", async () => {
    const client = new OpenRouterClient("test-key");
    await client.chat({
      model: "anthropic/claude-3.5-haiku",
      messages: [{ role: "system", content: "You are helpful" }],
    });

    const body = JSON.parse(lastFetchCall!.init.body as string);
    const systemMsg = body.messages.find((m: any) => m.role === "system");
    expect(systemMsg.cache_control).toEqual({ type: "ephemeral" });
  });

  it("should NOT add cache_control for non-Anthropic models", async () => {
    const client = new OpenRouterClient("test-key");
    await client.chat({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: "You are helpful" }],
    });

    const body = JSON.parse(lastFetchCall!.init.body as string);
    const systemMsg = body.messages.find((m: any) => m.role === "system");
    expect(systemMsg?.cache_control).toBeUndefined();
  });
});

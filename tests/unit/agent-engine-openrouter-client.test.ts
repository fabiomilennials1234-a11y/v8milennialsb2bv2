/**
 * OpenRouterClient — contract correctness around assistant + tool_calls.
 *
 * Regression coverage for CR-2 (agent-engine fallback incident): assistant
 * messages carrying tool_calls must be sent with content === null (NOT empty
 * string). Some OpenRouter/OpenAI-compatible models reject "" and degrade
 * silently, producing empty final answers that cascade into the user-visible
 * "Desculpe, houve um problema..." fallback.
 *
 * These tests lock the on-the-wire shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubGlobal("Deno", {
  env: { get: (_k: string) => undefined },
});

import { OpenRouterClient } from "../../supabase/functions/agent-message/openrouter-client.ts";

const client = new OpenRouterClient("test-key");

function okResp(content = "ok") {
  return {
    ok: true,
    json: async () => ({ id: "r1", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }),
  };
}
function errResp(status: number) {
  return { ok: false, status, text: async () => `http ${status}` };
}

describe("OpenRouterClient.chat — transient retry (Bug 2 cause)", () => {
  const mockFetch = vi.fn();
  // retryBaseMs:0 → no real backoff delay in tests
  const retryClient = new OpenRouterClient("test-key", { retryBaseMs: 0, maxRetries: 2 });
  const req = { model: "google/gemini-2.5-flash", messages: [{ role: "user" as const, content: "oi" }] };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("succeeds on first try without retrying", async () => {
    mockFetch.mockResolvedValueOnce(okResp("hello"));
    const out = await retryClient.chat(req);
    expect(out.choices[0].message.content).toBe("hello");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 503 then succeeds", async () => {
    mockFetch.mockResolvedValueOnce(errResp(503));
    mockFetch.mockResolvedValueOnce(okResp("recovered"));
    const out = await retryClient.chat(req);
    expect(out.choices[0].message.content).toBe("recovered");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 rate limit then succeeds", async () => {
    mockFetch.mockResolvedValueOnce(errResp(429));
    mockFetch.mockResolvedValueOnce(okResp());
    await retryClient.chat(req);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("retries on network throw then succeeds", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    mockFetch.mockResolvedValueOnce(okResp());
    await retryClient.chat(req);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on persistent 503", async () => {
    mockFetch.mockResolvedValue(errResp(503));
    await expect(retryClient.chat(req)).rejects.toThrow(/503/);
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("does NOT retry transient 500 as if 400 — but DOES retry 500", async () => {
    mockFetch.mockResolvedValueOnce(errResp(500));
    mockFetch.mockResolvedValueOnce(okResp());
    await retryClient.chat(req);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe("OpenRouterClient.convertMessages — content/tool_calls contract", () => {
  it("preserves content:null when assistant has tool_calls", () => {
    const out = client.convertMessages([
      { role: "user", content: "a granel quais sabores tem?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "t1", type: "function", function: { name: "search_knowledge", arguments: '{"query":"sabores granel"}' } },
        ],
      },
      { role: "tool", content: "Sabores: morango, baunilha", tool_call_id: "t1" },
    ]);
    expect(out[0]).toEqual({ role: "user", content: "a granel quais sabores tem?" });
    expect(out[1].role).toBe("assistant");
    expect(out[1].content).toBeNull();
    expect(out[1].tool_calls).toBeDefined();
    expect(out[2]).toEqual({
      role: "tool",
      content: "Sabores: morango, baunilha",
      tool_call_id: "t1",
    });
  });

  it("coerces empty string content to null when assistant has tool_calls", () => {
    const out = client.convertMessages([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "t1", type: "function", function: { name: "f", arguments: "{}" } },
        ],
      },
    ]);
    expect(out[0].content).toBeNull();
  });

  it("keeps string content when assistant has tool_calls and text", () => {
    const out = client.convertMessages([
      {
        role: "assistant",
        content: "Deixa eu verificar.",
        tool_calls: [
          { id: "t1", type: "function", function: { name: "f", arguments: "{}" } },
        ],
      },
    ]);
    expect(out[0].content).toBe("Deixa eu verificar.");
  });

  it("coerces null content to empty string for assistant WITHOUT tool_calls", () => {
    // Models reject null content when there are no tool_calls.
    const out = client.convertMessages([
      { role: "assistant", content: null as unknown as string },
    ]);
    expect(out[0].content).toBe("");
  });

  it("passes through user/system content as-is", () => {
    const out = client.convertMessages(
      [{ role: "user", content: "hello" }],
      "you are a helpful assistant",
    );
    expect(out[0]).toEqual({ role: "system", content: "you are a helpful assistant" });
    expect(out[1]).toEqual({ role: "user", content: "hello" });
  });

  it("preserves tool_call_id on tool-role messages", () => {
    const out = client.convertMessages([
      { role: "tool", content: "result here", tool_call_id: "abc123" },
    ]);
    expect(out[0].tool_call_id).toBe("abc123");
  });
});

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

import { describe, it, expect } from "vitest";

// Deno env stub for module-load side effects (none here but safe)
// vi.stubGlobal not needed — the client module does not read Deno.env at import time
// beyond the request path (which runs only on .chat()).

import { OpenRouterClient } from "../../supabase/functions/agent-message/openrouter-client.ts";

const client = new OpenRouterClient("test-key");

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

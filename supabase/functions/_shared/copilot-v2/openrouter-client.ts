/**
 * openrouter-client — Copilot v2 LlmClient adapter over OpenRouter.
 *
 * Thin I/O adapter implementing the LlmClient interface the cognition-loop
 * depends on. Matches the v1 convention: OPENROUTER_API_KEY (Deno.env / Supabase
 * secret), the /chat/completions endpoint, Bearer auth, function-calling tools.
 * No business logic here — gates/budget/introspection live in the loop, which is
 * unit-tested with a fake client. This file is exercised by integration only.
 */

import type { LlmClient, LlmResponse, Msg, ToolSchema } from "./cognition-loop.ts";
import type { ModelId } from "./model-selector.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterClientOptions {
  model: ModelId;
  apiKey?: string;
  refererUrl?: string;
  temperature?: number;
  /** Hard cap on tokens per completion (defensive). */
  maxTokens?: number;
}

export function createOpenRouterClient(opts: OpenRouterClientOptions): LlmClient {
  const apiKey = opts.apiKey ?? Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const referer = opts.refererUrl ?? Deno.env.get("OPENROUTER_REFERER_URL") ?? "https://torquecrm.com.br";

  return {
    async complete(input: { system: string; messages: Msg[]; tools: ToolSchema[] }): Promise<LlmResponse> {
      if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

      const messages = [
        { role: "system", content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const body: Record<string, unknown> = {
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0.7,
      };
      if (opts.maxTokens) body.max_tokens = opts.maxTokens;
      if (input.tools.length > 0) {
        body.tools = input.tools.map((t) => ({ type: "function", function: t }));
        body.tool_choice = "auto";
      }

      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": referer,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
      }

      const json = await res.json();
      const message = json?.choices?.[0]?.message ?? {};
      const rawToolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> =
        message.tool_calls ?? [];

      return {
        text: typeof message.content === "string" ? message.content : null,
        toolCalls: rawToolCalls.map((tc, i) => ({
          id: tc.id ?? `tc_${i}`,
          name: tc.function?.name ?? "",
          args: safeParseArgs(tc.function?.arguments),
        })),
      };
    },
  };
}

function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

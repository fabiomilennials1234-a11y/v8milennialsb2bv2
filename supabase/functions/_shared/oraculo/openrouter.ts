/**
 * Adaptador de LLM para o laço do Oráculo.
 *
 * O modelo é trocável por variável de ambiente, sem deploy: quando o preço ou a
 * qualidade mudarem, ninguém precisa abrir um PR para reagir.
 */

import type { Llm, LlmReply, LlmRequest, ToolCall } from "./loop.ts";

export const MODELO_PADRAO = "google/gemini-3-flash-preview";

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  toolSchemas: unknown[];
  fetchImpl?: typeof fetch;
}

export function createOpenRouterLlm(opts: OpenRouterOptions): Llm {
  const model = opts.model || MODELO_PADRAO;
  const doFetch = opts.fetchImpl ?? fetch;

  return {
    async complete(req: LlmRequest): Promise<LlmReply> {
      const messages: Array<Record<string, unknown>> = [
        { role: "system", content: opts.systemPrompt },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      for (const r of req.toolResults) {
        messages.push({
          role: "user",
          content: `[resultado da ferramenta ${r.name}]\n${JSON.stringify(r.result)}`,
        });
      }

      const res = await doFetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, tools: opts.toolSchemas, tool_choice: "auto" }),
      });

      const data = await res.json();
      const choice = data?.choices?.[0]?.message ?? {};

      return {
        model: data?.model ?? model,
        inputTokens: data?.usage?.prompt_tokens ?? 0,
        outputTokens: data?.usage?.completion_tokens ?? 0,
        text: typeof choice.content === "string" ? choice.content : undefined,
        toolCalls: readToolCalls(choice.tool_calls),
      };
    },
  };
}

function readToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const calls: ToolCall[] = [];
  for (const c of raw) {
    const name = c?.function?.name;
    if (typeof name !== "string") continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c?.function?.arguments ?? "{}");
    } catch {
      // Argumento malformado não derruba o turno: a ferramenta aplica os
      // próprios padrões e o Escopo continua vindo do servidor.
    }
    calls.push({ name, arguments: args });
  }

  return calls.length > 0 ? calls : undefined;
}

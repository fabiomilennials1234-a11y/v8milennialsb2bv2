/**
 * fake-llm — Copilot v2 deterministic LlmClient for the simulator/eval tests
 * (Slice 9). Records every call (so tests can assert the real system prompt was
 * built) and replays a scripted sequence of responses. Pure, no network.
 */

import type { LlmClient, LlmResponse, Msg, ToolSchema } from "./cognition-loop.ts";

export interface FakeLlmCall {
  system: string;
  messages: Msg[];
  tools: ToolSchema[];
}

export interface FakeLlm extends LlmClient {
  calls: FakeLlmCall[];
}

/**
 * `script` is either a fixed list of responses (one per complete() call, the last
 * one repeats) or a function of the call index + system prompt. A bare reply is
 * the common case: `createFakeLlm([{ text: "oi", toolCalls: [] }])`.
 */
export function createFakeLlm(
  script: LlmResponse[] | ((callIndex: number, system: string) => LlmResponse),
): FakeLlm {
  const calls: FakeLlmCall[] = [];
  return {
    calls,
    async complete(input: { system: string; messages: Msg[]; tools: ToolSchema[] }): Promise<LlmResponse> {
      const i = calls.length;
      calls.push({ system: input.system, messages: input.messages, tools: input.tools });
      if (typeof script === "function") return script(i, input.system);
      return script[Math.min(i, script.length - 1)] ?? { text: null, toolCalls: [] };
    },
  };
}

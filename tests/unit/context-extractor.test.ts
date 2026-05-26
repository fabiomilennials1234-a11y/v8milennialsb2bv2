/**
 * Context Extractor — LLM-based conversation context extraction.
 *
 * Tests the public interface: extractConversationContext().
 * Mocks LLM client to return structured JSON.
 */

import { describe, it, expect, vi } from "vitest";
import {
  extractConversationContext,
  type ExtractedContext,
} from "../../supabase/functions/_shared/copilot/context-extractor.ts";

function makeMockLlm(response: string) {
  return {
    chat: vi.fn().mockResolvedValue({
      choices: [{ message: { content: response } }],
    }),
  };
}

const sampleMessages = [
  { role: "user", content: "Oi, vi o anúncio de vocês" },
  { role: "assistant", content: "Olá! Que bom que nos encontrou. Qual sua empresa?" },
  { role: "user", content: "Sou da Metalúrgica Silva, mas preciso falar com meu sócio antes" },
];

const validExtraction: ExtractedContext = {
  objections: ["precisa falar com sócio antes de decidir"],
  intent: "exploring",
  sentiment: "warm",
  collected_info: { company: "Metalúrgica Silva" },
  suggested_next_action: "aguardar retorno e fazer follow-up em 2 dias",
};

describe("extractConversationContext", () => {
  it("should return structured context from LLM response", async () => {
    const mockLlm = makeMockLlm(JSON.stringify(validExtraction));
    const result = await extractConversationContext(sampleMessages, mockLlm as any);

    expect(result).not.toBeNull();
    expect(result!.objections).toContain("precisa falar com sócio antes de decidir");
    expect(result!.intent).toBe("exploring");
    expect(result!.sentiment).toBe("warm");
    expect(result!.collected_info.company).toBe("Metalúrgica Silva");
  });

  it("should return null on LLM failure", async () => {
    const mockLlm = {
      chat: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    };
    const result = await extractConversationContext(sampleMessages, mockLlm as any);

    expect(result).toBeNull();
  });

  it("should return null on invalid JSON response", async () => {
    const mockLlm = makeMockLlm("this is not json");
    const result = await extractConversationContext(sampleMessages, mockLlm as any);

    expect(result).toBeNull();
  });

  it("should handle empty messages array", async () => {
    const mockLlm = makeMockLlm(JSON.stringify(validExtraction));
    const result = await extractConversationContext([], mockLlm as any);

    expect(result).toBeNull();
  });
});

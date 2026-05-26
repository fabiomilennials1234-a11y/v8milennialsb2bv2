/**
 * Prompt trim — verifica que seções boilerplate foram cortadas/simplificadas.
 *
 * Testa buildDynamicPrompt em playground mode (system_prompt set).
 * Seções cortadas: Dynamic Capabilities verbose, Final Instructions,
 * Output Format verbose, Reasoning Chain verbose.
 */

import { describe, it, expect, vi } from "vitest";
import { buildDynamicPrompt } from "../../supabase/functions/agent-message/engine/build-prompt.ts";

const mockSupabase = {
  from: () => ({
    select: () => ({
      eq: () => ({
        not: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
  }),
} as any;

const baseParams = {
  supabase: mockSupabase,
  capabilities: {
    system_prompt: "You are a sales assistant for Acme Corp.",
    can_qualify_lead: true,
    can_schedule_meeting: true,
    can_transfer_human: true,
    reasoning_mode: "always",
  },
  conversation: { state: "QUALIFYING", turn_count: 5, context: {} },
  leadData: null,
  documentSummaries: [],
  semanticContext: "",
  longTermMemories: "",
  productCatalog: "",
  currentLeadId: null,
  conversationContext: null,
  incomingMessageType: "text",
  sentDocuments: [],
};

describe("Prompt trim — seções boilerplate", () => {
  it("should NOT contain verbose Dynamic Capabilities listing", async () => {
    const result = await buildDynamicPrompt(baseParams);

    expect(result).not.toContain("CAPABILITIES ATIVAS (você PODE fazer)");
    expect(result).not.toContain("CAPABILITIES DESATIVADAS (você NÃO PODE fazer)");
    expect(result).toContain("QUALIFYING");
    expect(result).toContain("5");
  });

  it("should NOT contain Final Instructions section", async () => {
    const result = await buildDynamicPrompt(baseParams);

    expect(result).not.toContain("# INSTRUÇÕES FINAIS");
    expect(result).not.toContain("Sempre mantenha o tom e estilo definidos");
    expect(result).not.toContain("Seja sempre ético, transparente e profissional");
  });

  it("should have compact Output Format (max 2 rules)", async () => {
    const result = await buildDynamicPrompt(baseParams);

    expect(result).not.toContain("Para executar qualquer ação (agendar, enviar material");
    expect(result).not.toContain("Para enviar um material, use a tool");
    expect(result).toContain("||SPLIT||");
  });

  it("should have compact Reasoning Chain (max 3 lines)", async () => {
    const result = await buildDynamicPrompt(baseParams);

    expect(result).toContain("<thinking>");
    expect(result).toContain("<response>");
    expect(result).not.toContain("Pense passo-a-passo:");
    expect(result).not.toContain("1. O que o lead realmente quer?");
  });
});

import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  capabilities: {
    id: "agent-1", can_move_cards: true, can_qualify_lead: false,
    active_pipes: ["pipeline-1"], active_stages: { "pipeline-1": ["aguardando_vendedor"] },
  },
  stages: [{ pipeline_id: "pipeline-1", pipeline_slug: "vendas", pipeline_name: "Vendas", stage_key: "aguardando_vendedor", name: "Aguardando vendedor" }],
  execute: vi.fn(async (_db: unknown, _action: { action_type: string }) => ({ success: true })),
  transfer: vi.fn(async () => ({ success: true })),
  stateUpdate: vi.fn(async () => {}),
}));

vi.stubGlobal("Deno", { env: { get: () => undefined, toObject: () => ({}) } });
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({ createClient: vi.fn() }));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({ logRuntime: vi.fn(async () => {}), redactSecrets: (v: unknown) => v }));
vi.mock("../../supabase/functions/_shared/embeddings.ts", () => ({ generateEmbedding: vi.fn() }));
vi.mock("../../supabase/functions/_shared/ai-queue.ts", () => ({ enqueueAiAction: vi.fn(async () => ({ queued: true })) }));
vi.mock("../../supabase/functions/_shared/ai-action-executor.ts", () => ({ immediateTransferHuman: fixture.transfer, executeAiAction: fixture.execute }));
vi.mock("../../supabase/functions/_shared/copilot/state-machine.ts", () => ({ updateConversationState: fixture.stateUpdate, determineNextState: vi.fn() }));
vi.mock("../../supabase/functions/_shared/copilot/context-extractor.ts", () => ({ extractConversationContext: vi.fn(async () => null) }));
vi.mock("../../supabase/functions/agent-message/engine/persist-response.ts", () => ({ updateContextSummaryAfterTurn: vi.fn(async () => {}), extractAndSaveMemories: vi.fn(async () => {}) }));
vi.mock("../../supabase/functions/_shared/copilot/dispatcher.ts", () => ({ addMessageToMemory: vi.fn(async () => {}), logDecision: vi.fn(), buildIdempotencyKey: vi.fn(), mapToolToAction: vi.fn() }));
vi.mock("../../supabase/functions/agent-message/engine/build-prompt.ts", () => ({ buildDynamicPrompt: vi.fn(async () => "prompt") }));
vi.mock("../../supabase/functions/agent-message/engine/history.ts", () => ({ loadConversationContext: vi.fn(async () => null), getConversationHistory: vi.fn(async () => []) }));
vi.mock("../../supabase/functions/agent-message/engine/load-context.ts", () => ({
  loadCapabilities: vi.fn(async () => fixture.capabilities),
  loadConversation: vi.fn(async () => ({ id: "conversation-1", state: "NEW_LEAD", turn_count: 0 })),
  loadLeadData: vi.fn(async () => ({ id: "lead-1" })),
  loadPipelineStages: vi.fn(async () => fixture.stages),
  loadOrgCustomFields: vi.fn(async () => []), loadDocumentSummaries: vi.fn(async () => []),
  loadProductCatalog: vi.fn(async () => ""), retrieveSemanticContext: vi.fn(async () => ""),
  retrieveLongTermMemories: vi.fn(async () => ""), loadConversationContextSummary: vi.fn(), getDefaultContext: vi.fn(),
}));

const { AgentEngine } = await import("../../supabase/functions/agent-message/agent-engine.ts");
const { OpenRouterClient } = await import("../../supabase/functions/agent-message/openrouter-client.ts");

describe("AgentEngine pipeline context independent from qualification", () => {
  it("does not offer CRM writes when the client corrects a summary", async () => {
    Object.assign(fixture.capabilities, {
      can_update_lead: true, can_transfer_human: true,
      context_config: { crm_actions_inline: true, require_summary_confirmation: true },
    });
    const chain = {
      select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    const router = new OpenRouterClient("unused-test-key");
    const chat = vi.spyOn(router, "chat").mockRejectedValue(new Error("stop-at-llm-boundary"));
    const engine = new AgentEngine({ from: () => chain } as never, router, "org-1");
    await expect(engine.processMessage("lead-1", "Corrigindo: são 3 caixas, e o número da rua é 120.")).rejects.toThrow("stop-at-llm-boundary");
    expect(chat.mock.calls[0][0].tools?.some(tool => ["update_lead", "advance_stage", "transfer_to_human"].includes(tool.function.name))).toBeFalsy();
  });
  it("executes the entire CRM handoff and retains WAITING_HUMAN before acknowledgement", async () => {
    Object.assign(fixture.capabilities, {
      can_update_lead: true, can_transfer_human: true,
      context_config: { crm_actions_inline: true, stage_movement_mode: "explicit" },
    });
    const pausedAt = new Date().toISOString();
    const chain = {
      select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      single: async () => ({ data: { ai_disabled_at: pausedAt }, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    const router = new OpenRouterClient("unused-test-key");
    vi.spyOn(router, "chat").mockResolvedValue({ choices: [{ finish_reason: "tool_calls", message: {
      role: "assistant", content: null, tool_calls: [
        { id: "tc-update", type: "function", function: { name: "update_lead", arguments: '{"updates":{"company":"Test"}}' } },
        { id: "tc-move", type: "function", function: { name: "advance_stage", arguments: '{"target_pipe":"vendas","target_stage":"aguardando_vendedor"}' } },
        { id: "tc-human", type: "function", function: { name: "transfer_to_human", arguments: '{"reason":"Cadastro completo"}' } },
      ],
    } }] } as never);
    const engine = new AgentEngine({ from: () => chain } as never, router, "org-1");
    const result = await engine.processMessage("lead-1", "Confere, pode encaminhar.");
    expect(fixture.execute.mock.calls.map(call => call[1].action_type)).toEqual(["update_lead", "advance_stage"]);
    expect(fixture.transfer).toHaveBeenCalledOnce();
    expect(fixture.execute.mock.invocationCallOrder[1]).toBeLessThan(fixture.transfer.mock.invocationCallOrder[0]);
    expect(result.state).toBe("WAITING_HUMAN");
    expect(result).toMatchObject({ handoff_receipt: { conversation_id: "conversation-1", paused_at: pausedAt } });
    expect(fixture.stateUpdate).toHaveBeenLastCalledWith(expect.anything(), "conversation-1", "WAITING_HUMAN");
  });
  it("offers the real custom funnel to a movement-only agent at the LLM boundary", async () => {
    const chain = {
      select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    const router = new OpenRouterClient("unused-test-key");
    const stop = new Error("stop-at-llm-boundary");
    const chat = vi.spyOn(router, "chat").mockRejectedValue(stop);
    const engine = new AgentEngine({ from: () => chain } as never, router, "org-1");
    await expect(engine.processMessage("lead-1", "Confere, pode encaminhar.")).rejects.toThrow(stop);
    const request = chat.mock.calls[0][0];
    const advance = request.tools?.find(tool => tool.function.name === "advance_stage");
    expect(advance).toBeDefined();
    expect(advance?.function.description).toContain("aguardando_vendedor");
    expect(request.tools?.some(tool => tool.function.name === "qualify_lead")).toBeFalsy();
  });
});

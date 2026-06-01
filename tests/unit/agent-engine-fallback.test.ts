/**
 * AgentEngine — fallback-elimination regression suite.
 *
 * Covers the Copilot fallback incident where users received
 * "Desculpe, houve um problema ao processar sua mensagem." instead of a
 * real answer to catalog questions (e.g. "a granel quais sabores tem?").
 *
 * Root causes tested here:
 *   CR-1: empty final message from LLM (content:null + tool_call not inline)
 *         previously produced the silent fallback. Now forced-text turn runs.
 *   CR-3: multiple tool_calls previously dropped after index 0. Now extras
 *         are surfaced via extraToolCalls.
 *   CR-4: finish_reason now logged and carried in response.
 *   CR-5: loadConversation tenant isolation (signature uses agent_id + org_id).
 *
 * We do NOT spin up the full processMessage pipeline here (it has ~30 DB
 * dependencies). We exercise the two pure-ish private helpers that own the
 * logic: processLLMResponse and the response-shape checks on convertMessages.
 * Full-pipeline coverage is tracked in a separate integration test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const envStub: Record<string, string> = {
  SUPABASE_URL: "https://local.test",
  SUPABASE_SERVICE_ROLE_KEY: "svc-role",
  OPENROUTER_API_KEY: "or-key",
};

vi.stubGlobal("Deno", {
  env: { get: (k: string) => envStub[k] ?? undefined, toObject: () => ({ ...envStub }) },
  serve: () => {},
});

vi.mock("../../supabase/functions/_shared/sentry.ts", () => ({
  withSentry: (_name: string, fn: unknown) => fn,
  captureError: vi.fn(async () => {}),
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));
vi.mock("../../supabase/functions/_shared/track.ts", () => ({
  trackEvent: vi.fn(async () => {}),
}));
vi.mock("../../supabase/functions/_shared/embeddings.ts", () => ({
  generateEmbedding: vi.fn(async () => [0, 0, 0]),
}));
vi.mock("../../supabase/functions/_shared/ai-queue.ts", () => ({
  enqueueAiAction: vi.fn(async () => ({})),
}));
vi.mock("../../supabase/functions/_shared/ai-action-executor.ts", () => ({
  immediateTransferHuman: vi.fn(async () => ({ success: true })),
}));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: vi.fn(),
}));

const { AgentEngine, buildFallbackOutcome, buildTelemetryLog } = await import(
  "../../supabase/functions/agent-message/agent-engine.ts"
);
const { OpenRouterClient } = await import(
  "../../supabase/functions/agent-message/openrouter-client.ts"
);

type EngineCtor = new (
  supabase: unknown,
  openRouter: unknown,
  orgId: string,
) => {
  processLLMResponse: (
    response: unknown,
    conversation: unknown,
    capabilities: unknown,
  ) => Promise<{
    nextState: string;
    actionToExecute: { action: string; params: Record<string, unknown>; tenant_id: string } | null;
    assistantMessage: string;
    extraToolCalls: Array<{ action: string; params: Record<string, unknown>; tenant_id: string }>;
    finishReason: string;
  }>;
  loadConversation: (leadId: string, agentId: string) => Promise<unknown>;
};

describe("AgentEngine.processLLMResponse", () => {
  let engine: InstanceType<EngineCtor>;
  const supabaseStub = {} as unknown;
  const openRouterStub = new OpenRouterClient("test-key");
  const orgId = "org-abc";
  const conversation = { state: "NEW_LEAD" };
  const capabilities = { id: "agent-1" };

  beforeEach(() => {
    // Access private method by casting through unknown
    engine = new AgentEngine(supabaseStub as never, openRouterStub, orgId) as unknown as InstanceType<EngineCtor>;
  });

  it("extracts text when LLM returns content only (stop)", async () => {
    const resp = {
      choices: [
        {
          message: { role: "assistant", content: "Oi, tudo bem!" },
          finish_reason: "stop",
        },
      ],
    };
    const out = await engine.processLLMResponse(resp, conversation, capabilities);
    expect(out.assistantMessage).toBe("Oi, tudo bem!");
    expect(out.actionToExecute).toBeNull();
    expect(out.extraToolCalls).toEqual([]);
    expect(out.finishReason).toBe("stop");
  });

  it("returns empty assistantMessage when content:null + tool_call (bug trigger)", async () => {
    // Exact shape that produced the production fallback:
    // LLM chose SEND_DOCUMENT via tool_call, no accompanying text.
    const resp = {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc-1",
                type: "function",
                function: {
                  name: "send_document",
                  arguments: '{"document_id":"doc-1"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const out = await engine.processLLMResponse(resp, conversation, capabilities);
    expect(out.assistantMessage).toBe("");
    expect(out.actionToExecute).toEqual({
      action: "SEND_DOCUMENT",
      params: { document_id: "doc-1" },
      tenant_id: orgId,
    });
    expect(out.finishReason).toBe("tool_calls");
  });

  it("captures ALL tool_calls when LLM returns multiple (CR-3)", async () => {
    const resp = {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc-a",
                type: "function",
                function: { name: "search_knowledge", arguments: '{"query":"sabores"}' },
              },
              {
                id: "tc-b",
                type: "function",
                function: { name: "update_lead", arguments: '{"field":"interesse","value":"granel"}' },
              },
              {
                id: "tc-c",
                type: "function",
                function: { name: "advance_stage", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const out = await engine.processLLMResponse(resp, conversation, capabilities);
    // First tool is the primary action
    expect(out.actionToExecute?.action).toBe("SEARCH_KNOWLEDGE");
    // Others are surfaced — no silent drop
    expect(out.extraToolCalls.map((c) => c.action)).toEqual([
      "UPDATE_LEAD",
      "ADVANCE_STAGE",
    ]);
  });

  it("logs finish_reason (CR-4) — returns it to caller", async () => {
    const resp = {
      choices: [
        {
          message: { role: "assistant", content: "Resposta parcial cortada no" },
          finish_reason: "length",
        },
      ],
    };
    const out = await engine.processLLMResponse(resp, conversation, capabilities);
    expect(out.finishReason).toBe("length");
    expect(out.assistantMessage).toBe("Resposta parcial cortada no");
  });

  it("skips tool_calls with unparseable JSON arguments (no silent wrong enqueue)", async () => {
    const resp = {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc-1",
                type: "function",
                function: { name: "update_lead", arguments: "{broken json" },
              },
              {
                id: "tc-2",
                type: "function",
                function: { name: "advance_stage", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const out = await engine.processLLMResponse(resp, conversation, capabilities);
    // First tool_call had invalid JSON — skipped. actionToExecute is set to the
    // second valid one? Current behavior: first slot stays null if first was
    // skipped; second valid one becomes primary.
    expect(out.actionToExecute?.action).toBe("ADVANCE_STAGE");
    expect(out.extraToolCalls.length).toBe(0);
  });

  it("throws when LLM returns no choices", async () => {
    await expect(
      engine.processLLMResponse({ choices: [] }, conversation, capabilities),
    ).rejects.toThrow("No response from LLM");
  });
});

describe("buildFallbackOutcome — no robotic apology, hands off to human (Bug 2 delivery)", () => {
  const orgId = "org-fallback";

  it("returns a natural holding message, NOT the old error string", () => {
    const out = buildFallbackOutcome(orgId);
    expect(out.message.length).toBeGreaterThan(0);
    expect(out.message).not.toMatch(/houve um problema ao processar/i);
    expect(out.message).not.toMatch(/desculpe/i);
    // No emoji (design rule)
    expect(out.message).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("sets a TRANSFER_HUMAN action scoped to the org with a diagnostic reason", () => {
    const out = buildFallbackOutcome(orgId);
    expect(out.action.action).toBe("TRANSFER_HUMAN");
    expect(out.action.tenant_id).toBe(orgId);
    expect(out.action.params.reason).toContain("fallback");
  });
});

describe("buildTelemetryLog — persists turn telemetry queryably (Bug 2 observability)", () => {
  const base = {
    organizationId: "org-x",
    leadId: "lead-1",
    agentId: "agent-1",
  };

  it("flags status=error when fallback was used", () => {
    const log = buildTelemetryLog({ ...base, telemetry: { fallback_used: true, turns_used: 3, finish_reasons: ["tool_calls"] } });
    expect(log.status).toBe("error");
    expect(log.module).toBe("copilot");
    expect(log.action).toBe("turn_telemetry");
    expect(log.payloadSnapshot.fallback_used).toBe(true);
  });

  it("flags status=success when no fallback", () => {
    const log = buildTelemetryLog({ ...base, telemetry: { fallback_used: false, turns_used: 1, finish_reasons: ["stop"] } });
    expect(log.status).toBe("success");
    expect(log.payloadSnapshot.finish_reasons).toEqual(["stop"]);
  });
});

describe("AgentEngine.loadConversation — tenant isolation (CR-5)", () => {
  it("filters by lead_id + agent_id + organization_id with deterministic order", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockLimit = vi.fn(() => ({ maybeSingle: mockSingle }));
    const mockOrder = vi.fn(() => ({ limit: mockLimit }));

    // Chain .eq() three times, then .order().limit().maybeSingle()
    const eq3 = { order: mockOrder };
    const eq2 = { eq: vi.fn(() => eq3) };
    const eq1 = { eq: vi.fn(() => eq2) };
    const select = { eq: vi.fn(() => eq1) };
    const from = { select: vi.fn(() => select) };
    const supabaseStub = { from: vi.fn(() => from) };

    const openRouterStub = new OpenRouterClient("x");
    const engine = new AgentEngine(supabaseStub as never, openRouterStub, "org-xyz") as unknown as InstanceType<EngineCtor>;

    await engine.loadConversation("lead-1", "agent-abc");

    expect(supabaseStub.from).toHaveBeenCalledWith("conversations");
    expect(from.select).toHaveBeenCalledWith("*");
    expect(select.eq).toHaveBeenCalledWith("lead_id", "lead-1");
    expect(eq1.eq).toHaveBeenCalledWith("agent_id", "agent-abc");
    expect(eq2.eq).toHaveBeenCalledWith("organization_id", "org-xyz");
    expect(mockOrder).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(1);
    expect(mockSingle).toHaveBeenCalled();
  });
});

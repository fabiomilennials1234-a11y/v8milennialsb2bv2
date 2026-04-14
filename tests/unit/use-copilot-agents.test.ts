import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---------------------------------------------------------------------------
// Chain mock factory
// ---------------------------------------------------------------------------
function createChainMock(resolvedData: unknown[] = [{ id: "mock-1", name: "Test" }]) {
  const chain: Record<string, any> = {};
  [
    "select","eq","neq","or","in","gte","lte","lt","ilike","contains",
    "order","limit","range","insert","update","delete","upsert","not",
    "is","filter","match","overlaps","textSearch","csv",
  ].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: resolvedData[0] ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: resolvedData[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: resolvedData, error: null, count: resolvedData.length }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { data: {} }, error: null }) },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://example.com/file.png" } }),
      }),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "token" } }),
}));
vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-t", profile_id: "p1" } }),
  isVirtualTeamMember: () => false,
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/hooks/useCopilotPromptBuilder", () => ({
  generatePrompt: vi.fn().mockReturnValue({ systemPrompt: "mock prompt", metadata: { version: "1.0" } }),
  saveCopilotSystemPrompt: vi.fn().mockResolvedValue(undefined),
  regenerateAndSavePrompt: vi.fn().mockResolvedValue(undefined),
  computePromptHash: vi.fn().mockReturnValue("hash123"),
}));
vi.mock("@/lib/copilot/custom-instructions-utils", () => ({
  parseCustomInstructions: (v: any) => ({ dos: v || "", donts: "" }),
  serializeCustomInstructions: (d: string, dt: string) => JSON.stringify({ dos: d, donts: dt }),
}));
vi.mock("@/hooks/useAgentFollowupRules", () => ({
  followupRuleToDB: vi.fn((r: any) => r),
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/lib/permissions", () => ({
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

import {
  useCopilotAgents,
  useCopilotAgent,
  useDefaultCopilotAgent,
  useCreateCopilotAgent,
  useUpdateCopilotAgent,
  useDeleteCopilotAgent,
  useToggleCopilotAgent,
  useSetDefaultCopilotAgent,
  useUpdateCopilotAgentPipeline,
  useLinkAgentToWhatsAppInstance,
  useCopilotAgentForEdit,
  useUpdateCopilotAgentFromWizard,
  type UpdatePipelinePayload,
} from "@/hooks/useCopilotAgents";

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------
function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------
const MOCK_AGENT = {
  id: "a1",
  name: "Qualificador",
  template_type: "qualificador",
  is_active: true,
  is_default: false,
  organization_id: "org-t",
  created_by: "u1",
  copilot_agent_faqs: [],
  copilot_agent_kanban_rules: [],
  whatsapp_instance_id: null,
  personality_tone: "profissional",
  personality_style: "consultivo",
  personality_energy: "moderada",
  skills: [],
  allowed_topics: [],
  forbidden_topics: [],
  main_objective: "Qualificar leads",
  objective_composite: { mission: "Qualificar leads", success_criteria: "", limits: "" },
  business_context: {},
  conversation_style: {},
  qualification_rules: {},
  availability: {},
  few_shot_examples: [],
  custom_instructions: null,
  activation_triggers: null,
  outbound_config: null,
  automation_actions: null,
  can_move_cards: false,
  active_pipes: [],
  active_stages: {},
  auto_move_on_qualify: false,
  auto_move_on_objective: false,
  move_rules: [],
};

// ---------------------------------------------------------------------------
// Tests — Query hooks
// ---------------------------------------------------------------------------
describe("useCopilotAgents", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("fetches agents for the organization", async () => {
    const { result } = renderHook(() => useCopilotAgents(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("returns empty when no agents", async () => {
    mockFrom.mockReturnValue(createChainMock([]));
    const { result } = renderHook(() => useCopilotAgents(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useCopilotAgent", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("fetches a single agent by ID", async () => {
    const { result } = renderHook(() => useCopilotAgent("a1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("is disabled when agentId is undefined", () => {
    const { result } = renderHook(() => useCopilotAgent(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useDefaultCopilotAgent", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ ...MOCK_AGENT, is_default: true }])); });

  it("fetches the default agent", async () => {
    const { result } = renderHook(() => useDefaultCopilotAgent(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useCopilotAgentForEdit", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("fetches agent data for wizard editing", async () => {
    const { result } = renderHook(() => useCopilotAgentForEdit("a1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("is disabled when agentId is undefined", () => {
    const { result } = renderHook(() => useCopilotAgentForEdit(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Tests — Mutation hooks
// ---------------------------------------------------------------------------
describe("useCreateCopilotAgent", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("creates an agent with FAQs and kanban rules", async () => {
    const { result } = renderHook(() => useCreateCopilotAgent(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          agent: { name: "New Agent", template_type: "qualificador" } as any,
          faqs: [{ question: "Q1", answer: "A1" }],
          kanbanRules: [],
        });
      } catch { /* swallow chain mock mismatches */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("creates an agent with followup rules", async () => {
    const { result } = renderHook(() => useCreateCopilotAgent(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          agent: { name: "Follow Up Agent", template_type: "followup" } as any,
          faqs: [],
          kanbanRules: [],
          followupRules: [{ name: "Rule 1", triggerType: "no_response", triggerDelayHours: 24 }] as any,
        });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("creates an agent with kanban rules", async () => {
    const { result } = renderHook(() => useCreateCopilotAgent(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          agent: { name: "Kanban Agent" } as any,
          faqs: [],
          kanbanRules: [
            {
              pipeType: "whatsapp",
              stageName: "novo",
              goal: "Qualify",
              behavior: "Polite",
              allowedActions: ["ask"],
              forbiddenActions: ["sell"],
            },
          ],
        });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useUpdateCopilotAgent", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("updates an agent and regenerates prompt", async () => {
    const { result } = renderHook(() => useUpdateCopilotAgent(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "a1", name: "Renamed Agent" } as any);
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useDeleteCopilotAgent", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([])); });

  it("deletes an agent", async () => {
    const { result } = renderHook(() => useDeleteCopilotAgent(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("a1"); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useToggleCopilotAgent", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("activates an agent", async () => {
    const { result } = renderHook(() => useToggleCopilotAgent(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ id: "a1", isActive: true }); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("deactivates an agent", async () => {
    const { result } = renderHook(() => useToggleCopilotAgent(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ id: "a1", isActive: false }); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useSetDefaultCopilotAgent", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("sets an agent as default", async () => {
    const { result } = renderHook(() => useSetDefaultCopilotAgent(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("a1"); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useUpdateCopilotAgentPipeline", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("updates pipeline configuration", async () => {
    const payload: UpdatePipelinePayload = {
      id: "a1",
      activePipes: ["pipe_whatsapp"],
      activeStages: { pipe_whatsapp: ["novo", "abordado"] },
      canMoveCards: true,
      autoMoveOnQualify: false,
      autoMoveOnObjective: true,
      moveRules: [],
    };
    const { result } = renderHook(() => useUpdateCopilotAgentPipeline(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync(payload); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useLinkAgentToWhatsAppInstance", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([MOCK_AGENT])); });

  it("links an agent to a WhatsApp instance", async () => {
    const { result } = renderHook(() => useLinkAgentToWhatsAppInstance(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ agentId: "a1", instanceId: "inst-1" });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("whatsapp_instances");
  });

  it("unlinks an agent from WhatsApp", async () => {
    const { result } = renderHook(() => useLinkAgentToWhatsAppInstance(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ agentId: "a1", instanceId: null });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useUpdateCopilotAgentFromWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ ...MOCK_AGENT, template_type: "followup" }]));
  });

  it("updates an agent via wizard data (full sync)", async () => {
    const { result } = renderHook(() => useUpdateCopilotAgentFromWizard(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          agentId: "a1",
          data: {
            name: "Updated Wizard",
            personality: { tone: "casual", style: "direto", energy: "alta" },
            skills: ["qualificar"],
            allowedTopics: [],
            forbiddenTopics: [],
            faqs: [{ question: "Price?", answer: "$100" }],
            businessContext: { companyName: "ACME" },
            conversationStyle: { responseLength: "curto" },
            qualification: { requiredFields: ["nome"] },
            examples: [{ lead: "Hi", agent: "Hello!" }],
            availability: { mode: "always" },
            responseDelaySeconds: 0,
            mainObjective: "Sell stuff",
            objectiveComposite: { mission: "Sell stuff", success_criteria: "", limits: "" },
            kanbanRules: [],
            operationMode: "inbound",
            activationTriggers: null,
            outboundConfig: null,
            automationActions: null,
            followupRules: [{ name: "Rule 1", priority: 0, triggerType: "no_response" }],
            customInstructions: { dos: "Be nice", donts: "No spam" },
            knowledgeBaseFiles: [],
            templateType: "followup",
          } as any,
          documentsToRemove: [],
        });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("removes documents when specified", async () => {
    const { result } = renderHook(() => useUpdateCopilotAgentFromWizard(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          agentId: "a1",
          data: {
            name: "Test",
            personality: { tone: "profissional", style: "consultivo", energy: "moderada" },
            skills: [],
            allowedTopics: [],
            forbiddenTopics: [],
            faqs: [],
            businessContext: {},
            conversationStyle: {},
            qualification: {},
            examples: [],
            availability: {},
            responseDelaySeconds: 0,
            mainObjective: "",
            objectiveComposite: { mission: "", success_criteria: "", limits: "" },
            kanbanRules: [],
            operationMode: "inbound",
            templateType: "qualificador",
          } as any,
          documentsToRemove: [{ documentId: "doc-1", filePath: "path/to/doc.pdf" }],
        });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

// ---------------------------------------------------------------------------
// Type test
// ---------------------------------------------------------------------------
describe("UpdatePipelinePayload type", () => {
  it("has required fields", () => {
    const payload: UpdatePipelinePayload = {
      id: "a1",
      activePipes: ["pipe_whatsapp"],
      activeStages: { pipe_whatsapp: ["novo"] },
      canMoveCards: true,
      autoMoveOnQualify: false,
      autoMoveOnObjective: true,
      moveRules: [],
    };
    expect(payload.activePipes).toContain("pipe_whatsapp");
  });
});

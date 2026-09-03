import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Build a reusable mock chain — every method returns the chain itself
// single/maybeSingle resolve with data, the chain itself is thenable
function createChainMock(overrides?: {
  singleData?: any;
  maybeSingleData?: any;
  thenData?: any;
}) {
  const chain: Record<string, any> = {};
  const methods = [
    "select", "eq", "neq", "or", "in", "gte", "lte", "lt",
    "ilike", "contains", "order", "limit", "range",
    "insert", "update", "delete", "upsert",
    "not", "is", "filter", "match", "overlaps", "textSearch",
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({
    data: overrides?.singleData ?? { id: "mock-1", organization_id: "org-t", name: "Test" },
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: overrides?.maybeSingleData ?? { id: "mock-1" },
    error: null,
  });
  // Make the chain thenable (for awaiting without .single())
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({
      data: overrides?.thenData ?? [{ id: "mock-1", name: "Test" }],
      error: null,
      count: 1,
    }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockChain = createChainMock();
const mockFrom = vi.fn().mockReturnValue(mockChain);
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...args: any[]) => mockRpc(...args),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    auth: { getUser: (...args: any[]) => mockGetUser(...args) },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn(),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }),
      }),
    },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: {} }),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));
vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({
  triggerFollowUpAutomation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/integrations/supabase/events", () => ({
  publishEvent: vi.fn().mockResolvedValue("evt-test"),
}));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
  assertPermission: vi.fn().mockResolvedValue(undefined),
  useCanPerformActionAsync: () => ({ data: { allowed: true }, isLoading: false }),
}));
vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => ({
    userId: "u1",
    organizationId: "org-t",
    teamMemberId: "tm1",
    effectiveRole: "admin" as const,
    isMaster: false,
    isAdmin: true,
    features: {} as Record<string, boolean>,
    isLoading: false,
    isReady: true,
  }),
}));
vi.mock("@/modules/identity/permissions/hooks/useCanDo", () => ({
  useCanDo: () => ({ allowed: true, reason: "admin", isLoading: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

// Import AFTER mocks
import {
  useCampanhas,
  useCampanha,
  useCampanhaStages,
  useAllCampanhaStages,
  useCampanhaMembers,
  useCampanhaLeads,
  useCreateCampanha,
  useUpdateCampanha,
  useDeleteCampanha,
  useUpdateCampanhaInvestimento,
  useUpdateCampanhaMktConfig,
  useAddCampanhaLead,
  useUpdateCampanhaLead,
  useDeleteCampanhaLead,
  useUpdateCampanhaMember,
  useCreateCampanhaStage,
  useUpdateCampanhaStage,
  useDeleteCampanhaStage,
  useReorderCampanhaStages,
  useCampanhaViewers,
  useAddCampanhaViewer,
  useRemoveCampanhaViewer,
  useCampanhaPipeAutomations,
  useCreateCampanhaPipeAutomation,
  useDeleteCampanhaPipeAutomation,
  useCampanhaDispatchRules,
  useCampanhaDispatchRuleSteps,
  useCreateCampanhaDispatchRule,
  useUpdateCampanhaDispatchRule,
  useDeleteCampanhaDispatchRule,
  useCreateCampanhaDispatchRuleStep,
  useUpdateCampanhaDispatchRuleStep,
  useDeleteCampanhaDispatchRuleStep,
  useExtractLeadToPipe,
  resolveExtractionTarget,
  // Constants
  OBJECTIVE_TARGET_MAP,
  OBJECTIVE_LABELS,
  OBJECTIVE_DESCRIPTIONS,
  OBJECTIVE_METRIC_LABELS,
  OBJECTIVE_SUCCESS_STAGE_LABELS,
  OBJECTIVE_DEFAULT_STAGES,
  getObjectiveMetricLabel,
  getObjectiveSuccessStageLabel,
} from "@/modules/campaigns/hooks/useCampanhas";

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ============================================================
// Constants
// ============================================================

describe("Campaign constants", () => {
  it("OBJECTIVE_TARGET_MAP has 3 objectives, keyed by canonical funnel refs (Fatia B)", () => {
    expect(Object.keys(OBJECTIVE_TARGET_MAP)).toHaveLength(3);
    expect(OBJECTIVE_TARGET_MAP.qualificacao.pipeline).toBe("whatsapp");
    expect(OBJECTIVE_TARGET_MAP.qualificacao.stage).toBe("novo");
    expect(OBJECTIVE_TARGET_MAP.agendamentos.pipeline).toBe("confirmacao");
    expect(OBJECTIVE_TARGET_MAP.agendamentos.stage).toBe("reuniao_marcada");
    expect(OBJECTIVE_TARGET_MAP.propostas.pipeline).toBe("propostas");
    expect(OBJECTIVE_TARGET_MAP.propostas.stage).toBe("marcar_compromisso");
  });

  it("OBJECTIVE_LABELS has 4 objectives", () => {
    expect(Object.keys(OBJECTIVE_LABELS)).toHaveLength(4);
    expect(OBJECTIVE_LABELS.qualificacao).toBe("Qualificação");
    expect(OBJECTIVE_LABELS.agendamentos).toBe("Agendamentos");
    expect(OBJECTIVE_LABELS.propostas).toBe("Propostas");
    expect(OBJECTIVE_LABELS.livre).toBe("Livre");
  });

  it("OBJECTIVE_DESCRIPTIONS maps all objectives", () => {
    const objectives = ["qualificacao", "agendamentos", "propostas", "livre"] as const;
    objectives.forEach((o) => expect(OBJECTIVE_DESCRIPTIONS[o]).toBeTruthy());
  });

  it("OBJECTIVE_METRIC_LABELS maps all objectives", () => {
    expect(OBJECTIVE_METRIC_LABELS.qualificacao).toBe("qualificações");
    expect(OBJECTIVE_METRIC_LABELS.agendamentos).toBe("reuniões");
    expect(OBJECTIVE_METRIC_LABELS.propostas).toBe("propostas");
    expect(OBJECTIVE_METRIC_LABELS.livre).toBe("conclusões");
  });

  it("OBJECTIVE_SUCCESS_STAGE_LABELS maps all", () => {
    expect(OBJECTIVE_SUCCESS_STAGE_LABELS.qualificacao).toBe("Etapa de Qualificação");
    expect(OBJECTIVE_SUCCESS_STAGE_LABELS.agendamentos).toBe("Reunião Marcada");
    expect(OBJECTIVE_SUCCESS_STAGE_LABELS.propostas).toBe("Etapa de Proposta");
    expect(OBJECTIVE_SUCCESS_STAGE_LABELS.livre).toBe("Etapa de Sucesso");
  });

  it("OBJECTIVE_DEFAULT_STAGES has stages for each objective", () => {
    const objectives = ["qualificacao", "agendamentos", "propostas", "livre"] as const;
    objectives.forEach((o) => {
      expect(OBJECTIVE_DEFAULT_STAGES[o].length).toBeGreaterThan(0);
      expect(OBJECTIVE_DEFAULT_STAGES[o][0]).toBe("Novo");
    });
  });
});

// ============================================================
// Pure helper functions
// ============================================================

describe("getObjectiveMetricLabel", () => {
  it("returns correct label for each objective", () => {
    expect(getObjectiveMetricLabel("qualificacao")).toBe("qualificações");
    expect(getObjectiveMetricLabel("agendamentos")).toBe("reuniões");
    expect(getObjectiveMetricLabel("propostas")).toBe("propostas");
    expect(getObjectiveMetricLabel("livre")).toBe("conclusões");
  });

  it("returns fallback for null", () => {
    expect(getObjectiveMetricLabel(null)).toBe("reuniões");
  });

  it("returns fallback for undefined", () => {
    expect(getObjectiveMetricLabel(undefined)).toBe("reuniões");
  });

  it("returns fallback for unknown value", () => {
    expect(getObjectiveMetricLabel("unknown" as any)).toBe("reuniões");
  });
});

describe("getObjectiveSuccessStageLabel", () => {
  it("returns correct label", () => {
    expect(getObjectiveSuccessStageLabel("qualificacao")).toBe("Etapa de Qualificação");
    expect(getObjectiveSuccessStageLabel("agendamentos")).toBe("Reunião Marcada");
    expect(getObjectiveSuccessStageLabel("propostas")).toBe("Etapa de Proposta");
    expect(getObjectiveSuccessStageLabel("livre")).toBe("Etapa de Sucesso");
  });

  it("returns fallback for null", () => {
    expect(getObjectiveSuccessStageLabel(null)).toBe("Reunião Marcada");
  });

  it("returns fallback for undefined", () => {
    expect(getObjectiveSuccessStageLabel(undefined)).toBe("Reunião Marcada");
  });

  it("returns fallback for unknown value", () => {
    expect(getObjectiveSuccessStageLabel("unknown" as any)).toBe("Reunião Marcada");
  });
});

describe("resolveExtractionTarget", () => {
  const noCanon = { target_pipeline_id: null, target_stage_id: null };
  const P1 = "0f0e0d0c-0b0a-4a4b-8c8d-9e9f00010203";
  const S1 = "11111111-2222-4333-8444-555566667777";

  it("prefers the canonical pair (target_pipeline_id + target_stage_id) — any funnel", () => {
    expect(
      resolveExtractionTarget({
        objective: "qualificacao",
        free_target_pipe: null,
        free_target_stage: null,
        target_pipeline_id: P1,
        target_stage_id: S1,
      })
    ).toEqual({ pipeline: P1, stage: S1 });
  });

  it("falls back to the legacy map for qualificacao", () => {
    expect(
      resolveExtractionTarget({ objective: "qualificacao", free_target_pipe: null, free_target_stage: null, ...noCanon })
    ).toEqual({ pipeline: "whatsapp", stage: "novo" });
  });

  it("falls back to the legacy map for agendamentos", () => {
    expect(
      resolveExtractionTarget({ objective: "agendamentos", free_target_pipe: null, free_target_stage: null, ...noCanon })
    ).toEqual({ pipeline: "confirmacao", stage: "reuniao_marcada" });
  });

  it("falls back to the legacy map for propostas", () => {
    expect(
      resolveExtractionTarget({ objective: "propostas", free_target_pipe: null, free_target_stage: null, ...noCanon })
    ).toEqual({ pipeline: "propostas", stage: "marcar_compromisso" });
  });

  it("reads the legacy livre config forever — the pipe_* alias travels as-is", () => {
    expect(
      resolveExtractionTarget({ objective: "livre", free_target_pipe: "pipe_whatsapp", free_target_stage: "novo", ...noCanon })
    ).toEqual({ pipeline: "pipe_whatsapp", stage: "novo" });
  });

  it("returns null for livre without config", () => {
    expect(
      resolveExtractionTarget({ objective: "livre", free_target_pipe: null, free_target_stage: null, ...noCanon })
    ).toBeNull();
  });

  it("returns null for livre with partial config (pipe only)", () => {
    expect(
      resolveExtractionTarget({ objective: "livre", free_target_pipe: "pipe_whatsapp", free_target_stage: null, ...noCanon })
    ).toBeNull();
  });

  it("returns null for livre with partial config (stage only)", () => {
    expect(
      resolveExtractionTarget({ objective: "livre", free_target_pipe: null, free_target_stage: "novo", ...noCanon })
    ).toBeNull();
  });

  it("ignores a canonical pair missing one half — falls through to the legacy path", () => {
    expect(
      resolveExtractionTarget({
        objective: "livre",
        free_target_pipe: null,
        free_target_stage: null,
        target_pipeline_id: P1,
        target_stage_id: null,
      })
    ).toBeNull();
  });
});

// ============================================================
// Query hooks
// ============================================================

describe("useCampanhas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches campanhas for the organization", async () => {
    const { result } = renderHook(() => useCampanhas(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });

  it("returns array data", async () => {
    const { result } = renderHook(() => useCampanhas(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
  });
});

describe("useCampanha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches a single campanha by id", async () => {
    const { result } = renderHook(() => useCampanha("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });

  it("does not fetch when id is undefined", async () => {
    const { result } = renderHook(() => useCampanha(undefined), { wrapper: createWrapper() });
    // Should stay in idle/pending state, never succeed
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCampanhaStages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches stages for a campaign", async () => {
    const { result } = renderHook(() => useCampanhaStages("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });

  it("does not fetch when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampanhaStages(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useAllCampanhaStages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches stages for multiple campaigns", async () => {
    const { result } = renderHook(() => useAllCampanhaStages(["camp-1", "camp-2"]), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });

  it("does not fetch when campaignIds is empty", async () => {
    const { result } = renderHook(() => useAllCampanhaStages([]), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCampanhaMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches members for a campaign", async () => {
    const { result } = renderHook(() => useCampanhaMembers("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_members");
  });

  it("does not fetch when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampanhaMembers(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCampanhaLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches leads for a campaign", async () => {
    const { result } = renderHook(() => useCampanhaLeads("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");
  });

  it("does not fetch when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampanhaLeads(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCampanhaViewers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches viewers for a campaign", async () => {
    const { result } = renderHook(() => useCampanhaViewers("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_allowed_viewers");
  });

  it("does not fetch when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampanhaViewers(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCampanhaPipeAutomations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches pipe automations for a campaign", async () => {
    const { result } = renderHook(() => useCampanhaPipeAutomations("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_pipe_automations");
  });

  it("does not fetch when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampanhaPipeAutomations(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCampanhaDispatchRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches dispatch rules for a campaign", async () => {
    const { result } = renderHook(() => useCampanhaDispatchRules("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rules");
  });

  it("does not fetch when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampanhaDispatchRules(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCampanhaDispatchRuleSteps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("fetches dispatch rule steps for a rule", async () => {
    const { result } = renderHook(() => useCampanhaDispatchRuleSteps("rule-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });

  it("does not fetch when ruleId is undefined", async () => {
    const { result } = renderHook(() => useCampanhaDispatchRuleSteps(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ============================================================
// Mutation hooks
// ============================================================

describe("useCreateCampanha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = createChainMock({
      singleData: { id: "new-camp-1", organization_id: "org-t", name: "Test Campaign" },
    });
    mockFrom.mockReturnValue(chain);
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("creates a manual campanha with stages and members", async () => {
    const { result } = renderHook(() => useCreateCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        name: "Test Campaign",
        description: null,
        deadline: "2026-01-01",
        team_goal: 10,
        objective: "livre",
        campaign_type: "manual",
        stages: [{ name: "Novo", position: 0 }],
        memberIds: ["m1"],
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("team_members");
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
    expect(mockFrom).toHaveBeenCalledWith("campanha_members");
  });

  it("creates a semi_automatica campanha with templates", async () => {
    const { result } = renderHook(() => useCreateCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        name: "Semi Auto",
        description: "test",
        deadline: "2026-06-01",
        team_goal: 5,
        objective: "qualificacao",
        campaign_type: "semi_automatica",
        stages: [{ name: "Novo", position: 0 }],
        memberIds: ["m1"],
        templateIds: ["tpl-1", "tpl-2"],
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_templates");
  });

  it("creates an automatica campanha and links agent", async () => {
    const { result } = renderHook(() => useCreateCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        name: "Auto",
        description: null,
        deadline: "2026-06-01",
        team_goal: 5,
        objective: "agendamentos",
        campaign_type: "automatica",
        agent_id: "agent-1",
        stages: [{ name: "Novo", position: 0 }],
        memberIds: [],
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("creates campanha with member roles", async () => {
    const { result } = renderHook(() => useCreateCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        name: "With Roles",
        description: null,
        deadline: "2026-06-01",
        team_goal: 5,
        objective: "livre",
        campaign_type: "manual",
        stages: [],
        memberIds: ["m1", "m2"],
        memberRoles: { m1: "sdr", m2: "closer" },
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_members");
  });

  it("handles campanha with distribution modes", async () => {
    const { result } = renderHook(() => useCreateCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        name: "Distribution",
        description: null,
        deadline: "2026-06-01",
        team_goal: 5,
        objective: "livre",
        campaign_type: "manual",
        lead_distribution_mode: "round_robin",
        lead_assigned_to: "m1",
        closer_distribution_mode: "single",
        closer_assigned_to: "m2",
        whatsapp_instance_id: "wai-1",
        stages: [{ name: "Novo", position: 0 }],
        memberIds: ["m1"],
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });
});

describe("useUpdateCampanha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("updates a campanha", async () => {
    const { result } = renderHook(() => useUpdateCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "camp-1", name: "Updated" });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });

  it("updates a campanha with agent_id change (swaps agent)", async () => {
    const chain = createChainMock({
      singleData: { id: "camp-1", agent_id: "old-agent" },
    });
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useUpdateCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "camp-1", agent_id: "new-agent" });
    });
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });

  it("updates a campanha with agent_id set to null (detaches agent)", async () => {
    const chain = createChainMock({
      singleData: { id: "camp-1", agent_id: "old-agent" },
    });
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useUpdateCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "camp-1", agent_id: null });
    });
    // Should detach old agent but not attach null
    expect(mockFrom).toHaveBeenCalledWith("copilot_agents");
  });
});

describe("useDeleteCampanha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("deletes a campanha", async () => {
    const { result } = renderHook(() => useDeleteCampanha(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync("camp-1");
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });
});

describe("useUpdateCampanhaInvestimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("updates campaign investment (manual)", async () => {
    const { result } = renderHook(() => useUpdateCampanhaInvestimento(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "camp-1",
        investimento_cents: 50000,
        investimento_source: "manual",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });

  it("updates campaign investment (api source)", async () => {
    const { result } = renderHook(() => useUpdateCampanhaInvestimento(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "camp-1",
        investimento_cents: 100000,
        investimento_source: "api",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });

  it("clears campaign investment", async () => {
    const { result } = renderHook(() => useUpdateCampanhaInvestimento(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "camp-1",
        investimento_cents: null,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });
});

describe("useUpdateCampanhaMktConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("updates MKT config with call origins and tags", async () => {
    const { result } = renderHook(() => useUpdateCampanhaMktConfig(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "camp-1",
        mkt_call_origins: ["meta_ads", "google_ads"],
        mkt_call_tag_ids: ["tag-1"],
        mkt_incluir_call: true,
        mkt_investimento_call_cents: 10000,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });

  it("updates MKT config with cadastro settings", async () => {
    const { result } = renderHook(() => useUpdateCampanhaMktConfig(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "camp-1",
        mkt_cadastro_origins: ["whatsapp"],
        mkt_cadastro_tag_ids: ["tag-2"],
        mkt_incluir_cadastro: true,
        mkt_investimento_cadastro_cents: 20000,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });

  it("clears MKT config", async () => {
    const { result } = renderHook(() => useUpdateCampanhaMktConfig(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "camp-1",
        mkt_call_origins: null,
        mkt_call_tag_ids: null,
        mkt_incluir_call: null,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanhas");
  });
});

describe("useAddCampanhaLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("adds a lead to a campaign", async () => {
    const { result } = renderHook(() => useAddCampanhaLead(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        lead_id: "lead-1",
        stage_id: "s1",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");
  });

  it("adds a lead with responsible and sdr", async () => {
    const { result } = renderHook(() => useAddCampanhaLead(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        lead_id: "lead-1",
        stage_id: "s1",
        responsible_id: "m1",
        sdr_id: "m2",
        closer_id: "m3",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");
  });
});

describe("useUpdateCampanhaLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a campaign lead (move stage) and publishes lead.stage_changed event", async () => {
    // Return data with lead_id so onSettled publishes the event (slice 19 event-bus).
    const chain = createChainMock({
      singleData: { id: "cl-1", lead_id: "lead-1", stage_id: "s2", campanha_id: "camp-1" },
    });
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useUpdateCampanhaLead(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "cl-1",
        campanha_id: "camp-1",
        stage_id: "s2",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");

    const { publishEvent } = await import("@/integrations/supabase/events");
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "lead.stage_changed",
        aggregate_type: "campanha_lead",
        aggregate_id: "cl-1",
        organization_id: "org-t",
        payload: expect.objectContaining({
          lead_id: "lead-1",
          campaign_id: "camp-1",
          new_stage_key: "s2",
        }),
      }),
    );
  });

  it("updates a campaign lead with notes", async () => {
    mockFrom.mockReturnValue(createChainMock());
    const { result } = renderHook(() => useUpdateCampanhaLead(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "cl-1",
        campanha_id: "camp-1",
        notes: "Follow up needed",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");
  });

  it("updates responsible and sdr assignments", async () => {
    mockFrom.mockReturnValue(createChainMock());
    const { result } = renderHook(() => useUpdateCampanhaLead(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "cl-1",
        campanha_id: "camp-1",
        responsible_id: "m1",
        sdr_id: "m2",
        closer_id: "m3",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");
  });

  it("rolls back on error via onError callback", async () => {
    // Make the mutation fail to trigger onError
    const chain = createChainMock();
    chain.single = vi.fn().mockResolvedValue({ data: null, error: { message: "DB error", code: "500" } });
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useUpdateCampanhaLead(), { wrapper: createWrapper() });
    let didThrow = false;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          id: "cl-1",
          campanha_id: "camp-1",
          stage_id: "s2",
        });
      } catch {
        didThrow = true;
      }
    });
    expect(didThrow).toBe(true);
  });
});

describe("useDeleteCampanhaLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("deletes a campaign lead", async () => {
    const { result } = renderHook(() => useDeleteCampanhaLead(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "cl-1", campanha_id: "camp-1" });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");
  });
});

describe("useUpdateCampanhaMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("updates member meetings count", async () => {
    const { result } = renderHook(() => useUpdateCampanhaMember(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        team_member_id: "m1",
        meetings_count: 5,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_members");
  });

  it("updates member bonus earned", async () => {
    const { result } = renderHook(() => useUpdateCampanhaMember(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        team_member_id: "m1",
        bonus_earned: true,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_members");
  });

  it("updates member role", async () => {
    const { result } = renderHook(() => useUpdateCampanhaMember(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        team_member_id: "m1",
        role: "closer",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_members");
  });
});

describe("useCreateCampanhaStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("creates a new campaign stage", async () => {
    const { result } = renderHook(() => useCreateCampanhaStage(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        name: "New Stage",
        position: 0,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });

  it("creates a stage with color and is_reuniao_marcada", async () => {
    const { result } = renderHook(() => useCreateCampanhaStage(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        name: "Meeting Stage",
        position: 1,
        color: "#ff0000",
        is_reuniao_marcada: true,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });
});

describe("useUpdateCampanhaStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("updates a campaign stage name", async () => {
    const { result } = renderHook(() => useUpdateCampanhaStage(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "s1",
        campanha_id: "camp-1",
        name: "Updated Stage",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });

  it("updates stage position and color", async () => {
    const { result } = renderHook(() => useUpdateCampanhaStage(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "s1",
        campanha_id: "camp-1",
        position: 3,
        color: "#00ff00",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });

  it("updates is_reuniao_marcada flag", async () => {
    const { result } = renderHook(() => useUpdateCampanhaStage(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "s1",
        campanha_id: "camp-1",
        is_reuniao_marcada: true,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });
});

describe("useDeleteCampanhaStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a campaign stage (no leads in stage)", async () => {
    const chain = createChainMock({ thenData: [] });
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useDeleteCampanhaStage(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "s1", campanha_id: "camp-1" });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });

  it("throws when stage has leads", async () => {
    const chain = createChainMock({ thenData: [{ id: "cl-1" }] });
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useDeleteCampanhaStage(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "s1", campanha_id: "camp-1" });
      } catch (err: any) {
        expect(err.message).toContain("Não é possível excluir uma etapa que contém leads");
      }
    });
  });
});

describe("useReorderCampanhaStages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reorders campaign stages", async () => {
    const chain = createChainMock();
    // The chain.then (thenable) needs to resolve with error: null for Promise.all
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject);
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useReorderCampanhaStages(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        stages: [
          { id: "s1", position: 0 },
          { id: "s2", position: 1 },
          { id: "s3", position: 2 },
        ],
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_stages");
  });

  it("throws when one of the stage updates fails", async () => {
    const chain = createChainMock();
    // Make the chain resolve with an error for Promise.all
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({ data: null, error: { message: "Update failed", code: "500" } }).then(resolve, reject);
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useReorderCampanhaStages(), { wrapper: createWrapper() });
    let didThrow = false;
    await act(async () => {
      try {
        await result.current.mutateAsync({
          campanha_id: "camp-1",
          stages: [{ id: "s1", position: 0 }],
        });
      } catch (err: any) {
        didThrow = true;
        expect(err.message).toBe("Update failed");
      }
    });
    expect(didThrow).toBe(true);
  });
});

describe("useAddCampanhaViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("adds a viewer to a campaign", async () => {
    const { result } = renderHook(() => useAddCampanhaViewer(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        team_member_id: "m1",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_allowed_viewers");
  });
});

describe("useRemoveCampanhaViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("removes a viewer from a campaign", async () => {
    const { result } = renderHook(() => useRemoveCampanhaViewer(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "v1", campanha_id: "camp-1" });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_allowed_viewers");
  });
});

describe("useCreateCampanhaPipeAutomation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("creates a pipe automation", async () => {
    const { result } = renderHook(() => useCreateCampanhaPipeAutomation(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        campanha_stage_id: "s1",
        target_pipe: "pipe_whatsapp",
        pipe_stage: "novo",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_pipe_automations");
  });

  it("creates automation targeting pipe_confirmacao", async () => {
    const { result } = renderHook(() => useCreateCampanhaPipeAutomation(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        campanha_stage_id: "s2",
        target_pipe: "pipe_confirmacao",
        pipe_stage: "reuniao_marcada",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_pipe_automations");
  });

  it("creates automation targeting pipe_propostas", async () => {
    const { result } = renderHook(() => useCreateCampanhaPipeAutomation(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        campanha_stage_id: "s3",
        target_pipe: "pipe_propostas",
        pipe_stage: "marcar_compromisso",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_pipe_automations");
  });
});

describe("useDeleteCampanhaPipeAutomation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("deletes a pipe automation", async () => {
    const { result } = renderHook(() => useDeleteCampanhaPipeAutomation(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "pa-1", campanha_id: "camp-1" });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_pipe_automations");
  });
});

describe("useCreateCampanhaDispatchRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("creates a dispatch rule with lead_created trigger", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        trigger_type: "lead_created",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rules");
  });

  it("creates a dispatch rule with lead_moved_to_stage trigger", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        trigger_type: "lead_moved_to_stage",
        campanha_stage_id: "s1",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rules");
  });

  it("creates a dispatch rule with is_active false", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_id: "camp-1",
        trigger_type: "lead_created",
        is_active: false,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rules");
  });
});

describe("useUpdateCampanhaDispatchRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("updates dispatch rule trigger type", async () => {
    const { result } = renderHook(() => useUpdateCampanhaDispatchRule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "dr-1",
        campanha_id: "camp-1",
        trigger_type: "lead_moved_to_stage",
        campanha_stage_id: "s1",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rules");
  });

  it("updates dispatch rule is_active", async () => {
    const { result } = renderHook(() => useUpdateCampanhaDispatchRule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "dr-1",
        campanha_id: "camp-1",
        is_active: false,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rules");
  });

  it("updates dispatch rule to lead_created (resets stage_id to null)", async () => {
    const { result } = renderHook(() => useUpdateCampanhaDispatchRule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "dr-1",
        campanha_id: "camp-1",
        trigger_type: "lead_created",
        campanha_stage_id: "s1", // Should be ignored / set to null
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rules");
  });
});

describe("useDeleteCampanhaDispatchRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("deletes a dispatch rule", async () => {
    const { result } = renderHook(() => useDeleteCampanhaDispatchRule(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "dr-1", campanha_id: "camp-1" });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rules");
  });
});

describe("useCreateCampanhaDispatchRuleStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("creates a send_template step", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        rule_id: "rule-1",
        action_type: "send_template",
        template_id: "tpl-1",
        delay_minutes: 5,
        position: 0,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });

  it("creates a wait_response step with timeout", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        rule_id: "rule-1",
        action_type: "wait_response",
        delay_minutes: 0,
        position: 1,
        wait_timeout_minutes: 60,
        timeout_action: "change_stage",
        timeout_target_stage_id: "s2",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });

  it("creates a change_stage step", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        rule_id: "rule-1",
        action_type: "change_stage",
        delay_minutes: 0,
        position: 2,
        target_stage_id: "s3",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });

  it("creates an assign_sdr step with round_robin", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        rule_id: "rule-1",
        action_type: "assign_sdr",
        delay_minutes: 0,
        position: 3,
        sdr_assignment_mode: "round_robin",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });

  it("creates an assign_sdr step with specific sdr", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        rule_id: "rule-1",
        action_type: "assign_sdr",
        delay_minutes: 0,
        position: 4,
        sdr_assignment_mode: "specific",
        target_sdr_id: "m1",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });

  it("creates step with default action_type and delay clamp", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        rule_id: "rule-1",
        position: 0,
        delay_minutes: -10, // Should be clamped to 0
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });

  it("creates step with timeout_template_id", async () => {
    const { result } = renderHook(() => useCreateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        rule_id: "rule-1",
        action_type: "wait_response",
        position: 1,
        delay_minutes: 0,
        wait_timeout_minutes: 30,
        timeout_action: "send_template",
        timeout_template_id: "tpl-timeout",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });
});

describe("useUpdateCampanhaDispatchRuleStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("updates step template_id", async () => {
    const { result } = renderHook(() => useUpdateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "step-1",
        rule_id: "rule-1",
        template_id: "tpl-2",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });

  it("updates step delay_minutes and position", async () => {
    const { result } = renderHook(() => useUpdateCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        id: "step-1",
        rule_id: "rule-1",
        delay_minutes: 30,
        position: 2,
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });
});

describe("useDeleteCampanhaDispatchRuleStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("deletes a dispatch rule step", async () => {
    const { result } = renderHook(() => useDeleteCampanhaDispatchRuleStep(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ id: "step-1", rule_id: "rule-1" });
    });
    expect(mockFrom).toHaveBeenCalledWith("campanha_dispatch_rule_steps");
  });
});

// ============================================================
// useExtractLeadToPipe — motor único por pipeline_entries (Fatia B)
// ============================================================

const PIPE_UUID = "0f0e0d0c-0b0a-4a4b-8c8d-9e9f00010203";
const STAGE_UUID = "11111111-2222-4333-8444-555566667777";

/**
 * Roteia mockFrom por tabela: pipelines/pipeline_stages resolvem o destino,
 * pipeline_entries devolve as entries existentes (thenable), campanha_leads
 * grava o delete. Devolve as chains pra asserção fina.
 */
function extractionTables(opts?: {
  pipelineRow?: any;
  stageRow?: any;
  entries?: any[];
}) {
  const pipelines = createChainMock({
    maybeSingleData: opts?.pipelineRow ?? { id: PIPE_UUID, slug: "whatsapp" },
  });
  if (opts && "pipelineRow" in opts && opts.pipelineRow === null) {
    pipelines.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  }
  const stages = createChainMock({
    maybeSingleData: opts?.stageRow ?? { id: STAGE_UUID, stage_key: "novo" },
  });
  if (opts && "stageRow" in opts && opts.stageRow === null) {
    stages.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  }
  const entries = createChainMock({ thenData: opts?.entries ?? [] });
  const campanhaLeads = createChainMock();
  mockFrom.mockImplementation((table: string) => {
    if (table === "pipelines") return pipelines;
    if (table === "pipeline_stages") return stages;
    if (table === "pipeline_entries") return entries;
    if (table === "campanha_leads") return campanhaLeads;
    return createChainMock();
  });
  return { pipelines, stages, entries, campanhaLeads };
}

describe("useExtractLeadToPipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a pipeline_entries row when the lead is not in the funnel", async () => {
    const t = extractionTables();
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
      });
    });
    expect(mockFrom).toHaveBeenCalledWith("pipelines");
    expect(mockFrom).toHaveBeenCalledWith("pipeline_stages");
    expect(t.entries.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: "lead-1",
        organization_id: "org-t",
        pipeline_id: PIPE_UUID,
        stage_id: STAGE_UUID,
        stage_key: "novo",
      }),
    );
    expect(mockFrom).toHaveBeenCalledWith("campanha_leads");
  });

  it("resolves the legacy pipe_* alias to the funnel slug — read-forever contract", async () => {
    const t = extractionTables();
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: "pipe_whatsapp",
        stage: "novo",
        organization_id: "org-t",
      });
    });
    // não é uuid → resolve por slug, com o alias traduzido
    expect(t.pipelines.eq).toHaveBeenCalledWith("slug", "whatsapp");
  });

  it("uses sdr_id as effective responsible when responsible_id is absent", async () => {
    const t = extractionTables();
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
        sdr_id: "m1",
      });
    });
    expect(t.entries.insert).toHaveBeenCalledWith(
      expect.objectContaining({ assigned_to: "m1" }),
    );
  });

  it("prefers responsible_id over sdr_id and closer_id", async () => {
    const t = extractionTables();
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
        responsible_id: "m1",
        sdr_id: "m2",
        closer_id: "m3",
      });
    });
    expect(t.entries.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_to: "m1",
        metadata: { responsible_id: "m1", sdr_id: "m2", closer_id: "m3" },
      }),
    );
  });

  it("falls back to closer_id when neither responsible nor sdr is given", async () => {
    const t = extractionTables();
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
        closer_id: "m3",
      });
    });
    expect(t.entries.insert).toHaveBeenCalledWith(
      expect.objectContaining({ assigned_to: "m3" }),
    );
  });

  it("updates the current entry (first OPEN one) instead of inserting", async () => {
    const t = extractionTables({
      entries: [
        { id: "closed-1", closed_at: "2026-01-01", entered_at: "2026-02-01" },
        { id: "open-1", closed_at: null, entered_at: "2026-01-15" },
      ],
    });
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: STAGE_UUID,
        organization_id: "org-t",
        campaign_name: "Test Campaign",
      });
    });
    expect(t.entries.insert).not.toHaveBeenCalled();
    expect(t.entries.update).toHaveBeenCalledWith(
      expect.objectContaining({
        stage_id: STAGE_UUID,
        stage_key: "novo",
        notes: "Campanha: Test Campaign",
      }),
    );
    expect(t.entries.eq).toHaveBeenCalledWith("id", "open-1");
  });

  it("falls back to the most recent entry when every entry is closed", async () => {
    const t = extractionTables({
      entries: [
        { id: "recent-closed", closed_at: "2026-03-01", entered_at: "2026-03-01" },
        { id: "old-closed", closed_at: "2026-01-01", entered_at: "2026-01-01" },
      ],
    });
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
      });
    });
    expect(t.entries.update).toHaveBeenCalled();
    expect(t.entries.eq).toHaveBeenCalledWith("id", "recent-closed");
  });

  it("triggers the legacy follow-up automation only for the trio slugs", async () => {
    const { triggerFollowUpAutomation } = await import("@/modules/workflows/hooks/useAutoFollowUp");
    extractionTables({ pipelineRow: { id: PIPE_UUID, slug: "confirmacao" } });
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
      });
    });
    expect(triggerFollowUpAutomation).toHaveBeenCalledWith(
      expect.objectContaining({ pipeType: "confirmacao" }),
    );
  });

  it("does NOT trigger follow-up automation for a custom funnel (parity: never had it)", async () => {
    const { triggerFollowUpAutomation } = await import("@/modules/workflows/hooks/useAutoFollowUp");
    extractionTables({ pipelineRow: { id: PIPE_UUID, slug: "pos-venda" } });
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
      });
    });
    expect(triggerFollowUpAutomation).not.toHaveBeenCalled();
  });

  it("rejects when the funnel does not resolve in the org — fail-closed, nothing written", async () => {
    const t = extractionTables({ pipelineRow: null });
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          campanha_lead_id: "cl-1",
          campanha_id: "camp-1",
          lead_id: "lead-1",
          pipeline: "funil-que-nao-existe",
          stage: "novo",
          organization_id: "org-t",
        });
      }),
    ).rejects.toThrow(/não encontrado/);
    expect(t.entries.insert).not.toHaveBeenCalled();
    expect(t.campanhaLeads.delete).not.toHaveBeenCalled();
  });

  it("rejects when the stage does not belong to the funnel", async () => {
    const t = extractionTables({ stageRow: null });
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await expect(
      act(async () => {
        await result.current.mutateAsync({
          campanha_lead_id: "cl-1",
          campanha_id: "camp-1",
          lead_id: "lead-1",
          pipeline: PIPE_UUID,
          stage: "etapa-fantasma",
          organization_id: "org-t",
        });
      }),
    ).rejects.toThrow(/Etapa/);
    expect(t.entries.insert).not.toHaveBeenCalled();
  });

  it("always deletes the campanha_lead after extraction", async () => {
    const t = extractionTables();
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
      });
    });
    expect(t.campanhaLeads.delete).toHaveBeenCalled();
    expect(t.campanhaLeads.eq).toHaveBeenCalledWith("id", "cl-1");
  });

  it("includes campaign_name as notes when inserting", async () => {
    const t = extractionTables();
    const { result } = renderHook(() => useExtractLeadToPipe(), { wrapper: createWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        campanha_lead_id: "cl-1",
        campanha_id: "camp-1",
        lead_id: "lead-1",
        pipeline: PIPE_UUID,
        stage: "novo",
        organization_id: "org-t",
        campaign_name: "My Campaign",
      });
    });
    expect(t.entries.insert).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Campanha: My Campaign" }),
    );
  });
});

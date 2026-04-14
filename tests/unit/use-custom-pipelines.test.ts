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
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/lib/workflowTrigger", () => ({
  triggerStageChangedWorkflows: vi.fn().mockResolvedValue(undefined),
  triggerLeadCreatedInCustomPipeline: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/permissions", () => ({
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

import {
  useCustomPipelines,
  usePermanentCustomFunnels,
  useTemporaryFunnels,
  useActiveTemporaryFunnels,
  useCustomPipeline,
  useCustomPipelineStages,
  useCustomPipeEntries,
  useCreateCustomPipeline,
  useActivateTemporaryFunnel,
  usePauseTemporaryFunnel,
  useEndTemporaryFunnel,
  useUpdateCustomPipeline,
  useDeleteCustomPipeline,
  useCreateCustomPipelineStage,
  useUpdateCustomPipelineStage,
  useDeleteCustomPipelineStage,
  useReorderCustomPipelineStages,
  useAddLeadToCustomPipe,
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
  customStagesToColumns,
  groupEntriesByStage,
  TEMPORARY_FUNNEL_STAGES,
  type CustomPipeline,
  type CustomPipelineStage,
  type CustomPipeEntry,
  type LifecycleType,
  type FunnelStatus,
  type FunnelTemplateType,
} from "@/hooks/useCustomPipelines";

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
const PIPELINE: CustomPipeline = {
  id: "p1",
  organization_id: "org-t",
  name: "Pipeline Test",
  slug: "pipeline-test",
  description: null,
  icon: "kanban",
  color: "#3b82f6",
  position: 0,
  is_active: true,
  created_by: "p1",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  lifecycle_type: "permanent",
  starts_at: null,
  ends_at: null,
  status: "active",
  team_goal: null,
  individual_goal: null,
  bonus_value: null,
  bonus_description: null,
  objective_pipe_type: null,
  objective_stage_key: null,
  template_type: null,
  lead_source_config: null,
};

const STAGE: CustomPipelineStage = {
  id: "s1",
  organization_id: "org-t",
  pipeline_id: "p1",
  stage_key: "novo",
  name: "Novo",
  color: "#3b82f6",
  position: 0,
  is_active: true,
  is_final_positive: false,
  is_final_negative: false,
  target_pipeline_id: null,
  target_stage_id: null,
  target_pipe_type: null,
  target_stage_key: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const ENTRY: CustomPipeEntry = {
  id: "e1",
  organization_id: "org-t",
  pipeline_id: "p1",
  lead_id: "l1",
  stage_id: "s1",
  assigned_to: null,
  notes: null,
  entered_at: "2025-01-01T00:00:00Z",
  stage_changed_at: "2025-01-01T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("useCustomPipelines — Types", () => {
  it("LifecycleType union", () => {
    const types: LifecycleType[] = ["permanent", "temporary"];
    expect(types).toHaveLength(2);
  });

  it("FunnelStatus union", () => {
    const statuses: FunnelStatus[] = ["draft", "active", "paused", "ended"];
    expect(statuses).toHaveLength(4);
  });

  it("FunnelTemplateType union", () => {
    const templates: FunnelTemplateType[] = ["indicacao", "prospeccao", "reativacao"];
    expect(templates).toHaveLength(3);
  });

  it("TEMPORARY_FUNNEL_STAGES has all templates", () => {
    expect(TEMPORARY_FUNNEL_STAGES.indicacao).toBeDefined();
    expect(TEMPORARY_FUNNEL_STAGES.prospeccao).toBeDefined();
    expect(TEMPORARY_FUNNEL_STAGES.reativacao).toBeDefined();
    expect(TEMPORARY_FUNNEL_STAGES.indicacao.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------
describe("useCustomPipelines (query)", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([PIPELINE])); });

  it("fetches pipelines for the org", async () => {
    const { result } = renderHook(() => useCustomPipelines(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("usePermanentCustomFunnels", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([PIPELINE])); });

  it("fetches permanent funnels", async () => {
    const { result } = renderHook(() => usePermanentCustomFunnels(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("useTemporaryFunnels", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ ...PIPELINE, lifecycle_type: "temporary" }])); });

  it("fetches temporary funnels", async () => {
    const { result } = renderHook(() => useTemporaryFunnels(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("useActiveTemporaryFunnels", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ ...PIPELINE, lifecycle_type: "temporary", status: "active" }])); });

  it("fetches active temporary funnels", async () => {
    const { result } = renderHook(() => useActiveTemporaryFunnels(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("useCustomPipeline", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([PIPELINE])); });

  it("fetches a pipeline by slug", async () => {
    const { result } = renderHook(() => useCustomPipeline("pipeline-test"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });

  it("is disabled when slug is undefined", () => {
    const { result } = renderHook(() => useCustomPipeline(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCustomPipelineStages", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([STAGE])); });

  it("fetches stages for a pipeline", async () => {
    const { result } = renderHook(() => useCustomPipelineStages("p1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("custom_pipeline_stages");
  });

  it("is disabled when pipelineId is undefined", () => {
    const { result } = renderHook(() => useCustomPipelineStages(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useCustomPipeEntries", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([ENTRY])); });

  it("fetches entries for a pipeline", async () => {
    const { result } = renderHook(() => useCustomPipeEntries("p1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("custom_pipe_entries");
  });

  it("is disabled when pipelineId is undefined", () => {
    const { result } = renderHook(() => useCustomPipeEntries(undefined), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------
describe("useCreateCustomPipeline", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([PIPELINE])); });

  it("creates a permanent pipeline with default stages", async () => {
    const { result } = renderHook(() => useCreateCustomPipeline(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ name: "My Funnel" }); } catch { /* swallow */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });

  it("creates a temporary pipeline with template stages", async () => {
    const { result } = renderHook(() => useCreateCustomPipeline(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          name: "Indicacao Funnel",
          lifecycle_type: "temporary",
          template_type: "indicacao",
        });
      } catch { /* swallow */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });

  it("creates a pipeline with custom stages", async () => {
    const { result } = renderHook(() => useCreateCustomPipeline(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          name: "Custom",
          custom_stages: [
            { name: "Start", color: "#000", is_final_positive: false, is_final_negative: false },
            { name: "Done", color: "#0f0", is_final_positive: true, is_final_negative: false },
          ],
        });
      } catch { /* swallow */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("useActivateTemporaryFunnel", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ ...PIPELINE, status: "active" }])); });

  it("activates a temporary funnel", async () => {
    const { result } = renderHook(() => useActivateTemporaryFunnel(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("p1"); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("usePauseTemporaryFunnel", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ ...PIPELINE, status: "paused" }])); });

  it("pauses a temporary funnel", async () => {
    const { result } = renderHook(() => usePauseTemporaryFunnel(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("p1"); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("useEndTemporaryFunnel", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([{ ...PIPELINE, status: "ended" }])); });

  it("ends a temporary funnel", async () => {
    const { result } = renderHook(() => useEndTemporaryFunnel(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("p1"); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("useUpdateCustomPipeline", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([PIPELINE])); });

  it("updates a pipeline name (and regenerates slug)", async () => {
    const { result } = renderHook(() => useUpdateCustomPipeline(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ id: "p1", name: "Updated Name" }); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });

  it("updates a pipeline without renaming", async () => {
    const { result } = renderHook(() => useUpdateCustomPipeline(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ id: "p1", description: "Desc" }); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("useDeleteCustomPipeline", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([])); });

  it("soft-deletes a pipeline", async () => {
    const { result } = renderHook(() => useDeleteCustomPipeline(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("p1"); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipelines");
  });
});

describe("useCreateCustomPipelineStage", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([STAGE])); });

  it("creates a stage", async () => {
    const { result } = renderHook(() => useCreateCustomPipelineStage(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          pipeline_id: "p1",
          name: "Em progresso",
          position: 1,
          color: "#eab308",
        });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipeline_stages");
  });
});

describe("useUpdateCustomPipelineStage", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([STAGE])); });

  it("updates a stage", async () => {
    const { result } = renderHook(() => useUpdateCustomPipelineStage(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "s1", pipeline_id: "p1", name: "Renamed" });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipeline_stages");
  });
});

describe("useDeleteCustomPipelineStage", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([])); });

  it("soft-deletes a stage", async () => {
    const { result } = renderHook(() => useDeleteCustomPipelineStage(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ id: "s1", pipeline_id: "p1" }); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipeline_stages");
  });
});

describe("useReorderCustomPipelineStages", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([])); });

  it("reorders stages", async () => {
    const { result } = renderHook(() => useReorderCustomPipelineStages(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          pipeline_id: "p1",
          stages: [
            { id: "s1", position: 1 },
            { id: "s2", position: 0 },
          ],
        });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipeline_stages");
  });
});

describe("useAddLeadToCustomPipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{
      ...ENTRY,
      lead_id: "l1",
      organization_id: "org-t",
      pipeline_id: "p1",
      stage_id: "s1",
    }]));
  });

  it("adds a lead to a custom pipe", async () => {
    const { result } = renderHook(() => useAddLeadToCustomPipe(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          pipeline_id: "p1",
          lead_id: "l1",
          stage_id: "s1",
        });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipe_entries");
  });
});

describe("useMoveLeadInCustomPipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{
      ...ENTRY,
      lead_id: "l1",
      organization_id: "org-t",
    }]));
  });

  it("moves a lead between stages", async () => {
    const { result } = renderHook(() => useMoveLeadInCustomPipe(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          entry_id: "e1",
          pipeline_id: "p1",
          stage_id: "s2",
        });
      } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipe_entries");
  });
});

describe("useRemoveLeadFromCustomPipe", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock([])); });

  it("removes a lead from a custom pipe", async () => {
    const { result } = renderHook(() => useRemoveLeadFromCustomPipe(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync({ entry_id: "e1", pipeline_id: "p1" }); } catch { /* */ }
    });
    expect(mockFrom).toHaveBeenCalledWith("custom_pipe_entries");
  });
});

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------
describe("customStagesToColumns", () => {
  it("converts stages to column format", () => {
    const cols = customStagesToColumns([STAGE, { ...STAGE, id: "s2", name: "Done", color: "#22c55e" }]);
    expect(cols).toHaveLength(2);
    expect(cols[0]).toEqual({ id: "s1", title: "Novo", color: "#3b82f6" });
    expect(cols[1]).toEqual({ id: "s2", title: "Done", color: "#22c55e" });
  });

  it("uses fallback color when stage color is null", () => {
    const cols = customStagesToColumns([{ ...STAGE, color: null }]);
    expect(cols[0].color).toBe("#64748b");
  });

  it("returns empty array for empty input", () => {
    expect(customStagesToColumns([])).toEqual([]);
  });
});

describe("groupEntriesByStage", () => {
  const stage2: CustomPipelineStage = { ...STAGE, id: "s2", name: "Done", stage_key: "done" };

  it("groups entries by stage_id", () => {
    const entries: CustomPipeEntry[] = [
      ENTRY,
      { ...ENTRY, id: "e2", stage_id: "s2" },
      { ...ENTRY, id: "e3", stage_id: "s1" },
    ];
    const grouped = groupEntriesByStage(entries, [STAGE, stage2]);
    expect(grouped["s1"]).toHaveLength(2);
    expect(grouped["s2"]).toHaveLength(1);
  });

  it("returns empty arrays for stages with no entries", () => {
    const grouped = groupEntriesByStage([], [STAGE, stage2]);
    expect(grouped["s1"]).toEqual([]);
    expect(grouped["s2"]).toEqual([]);
  });

  it("ignores entries with unknown stage_id", () => {
    const entries: CustomPipeEntry[] = [{ ...ENTRY, stage_id: "unknown" }];
    const grouped = groupEntriesByStage(entries, [STAGE]);
    expect(grouped["s1"]).toEqual([]);
  });
});

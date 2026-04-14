import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Chain mock helper ----

function createChainMock(data: unknown[] = []) {
  const chain: Record<string, any> = {};
  ["select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike", "contains", "order", "limit", "range", "insert", "update", "delete", "upsert", "not", "is", "filter", "match"].forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null }).then(resolve, reject);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---- Import hooks ----

import {
  useStageWorkflows,
  useCustomPipeStageWorkflows,
  useStageWorkflowCounts,
  useCustomPipeWorkflowCounts,
  useCampaignStageWorkflows,
  useCampaignWorkflowCounts,
} from "@/hooks/useStageWorkflows";

// ---- Test data ----

const workflowsData = [
  {
    id: "wf1",
    name: "Move to next",
    is_active: true,
    trigger_type: "stage_changed",
    trigger_config: { pipe_type: "whatsapp", stages: ["novo", "abordado"] },
  },
  {
    id: "wf2",
    name: "Notify closer",
    is_active: false,
    trigger_type: "stage_changed",
    trigger_config: { pipe_type: "whatsapp", to_stage: "agendado" },
  },
  {
    id: "wf3",
    name: "All stages",
    is_active: true,
    trigger_type: "stage_changed",
    trigger_config: { pipe_type: "whatsapp" },
  },
  {
    id: "wf4",
    name: "Custom pipe wf",
    is_active: true,
    trigger_type: "stage_changed",
    trigger_config: { pipeline_id: "custom-1", stages: ["stage-a"] },
  },
  {
    id: "wf5",
    name: "Campaign wf",
    is_active: true,
    trigger_type: "stage_changed",
    trigger_config: { campanha_id: "camp-1", to_stage: "contacted" },
  },
  {
    id: "wf6",
    name: "No cfg",
    is_active: true,
    trigger_type: "stage_changed",
    trigger_config: null,
  },
];

// ---- Tests ----

describe("useStageWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock(workflowsData));
  });

  it("returns workflows matching pipe_type and stage via stages array", async () => {
    const { result } = renderHook(() => useStageWorkflows("whatsapp", "novo"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    // wf1 (stages includes "novo") + wf3 (all stages)
    expect(data.length).toBe(2);
    expect(data.map(d => d.id)).toContain("wf1");
    expect(data.map(d => d.id)).toContain("wf3");
  });

  it("returns workflows matching to_stage", async () => {
    const { result } = renderHook(() => useStageWorkflows("whatsapp", "agendado"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    // wf2 (to_stage=agendado) + wf3 (all stages)
    expect(data.length).toBe(2);
    expect(data.map(d => d.id)).toContain("wf2");
  });

  it("is disabled when pipeType is undefined", async () => {
    const { result } = renderHook(() => useStageWorkflows(undefined, "novo"), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });

  it("is disabled when stageKey is undefined", async () => {
    const { result } = renderHook(() => useStageWorkflows("whatsapp", undefined), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });
});

describe("useCustomPipeStageWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock(workflowsData));
  });

  it("returns workflows matching pipeline_id and stage", async () => {
    const { result } = renderHook(() => useCustomPipeStageWorkflows("custom-1", "stage-a"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBe(1);
    expect(result.current.data![0].id).toBe("wf4");
  });

  it("is disabled when pipelineId is undefined", async () => {
    const { result } = renderHook(() => useCustomPipeStageWorkflows(undefined, "stage-a"), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });
});

describe("useStageWorkflowCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock(workflowsData));
  });

  it("counts workflows per stage for a pipe", async () => {
    const { result } = renderHook(() => useStageWorkflowCounts("whatsapp"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    // wf1 has stages=["novo","abordado"], wf2 has to_stage="agendado", wf3 has no stages (__all__)
    expect(data["novo"]).toEqual({ total: 1, active: 1 });
    expect(data["abordado"]).toEqual({ total: 1, active: 1 });
    expect(data["agendado"]).toEqual({ total: 1, active: 0 });
    expect(data["__all__"]).toEqual({ total: 1, active: 1 });
  });

  it("is disabled when pipeType is undefined", async () => {
    const { result } = renderHook(() => useStageWorkflowCounts(undefined), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });
});

describe("useCustomPipeWorkflowCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock(workflowsData));
  });

  it("counts workflows per stage for a custom pipeline", async () => {
    const { result } = renderHook(() => useCustomPipeWorkflowCounts("custom-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data["stage-a"]).toEqual({ total: 1, active: 1 });
  });

  it("is disabled when pipelineId is undefined", async () => {
    const { result } = renderHook(() => useCustomPipeWorkflowCounts(undefined), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });
});

describe("useCampaignStageWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock(workflowsData));
  });

  it("returns workflows matching campanha_id and stage", async () => {
    const { result } = renderHook(() => useCampaignStageWorkflows("camp-1", "contacted"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.length).toBe(1);
    expect(result.current.data![0].id).toBe("wf5");
  });

  it("is disabled when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampaignStageWorkflows(undefined, "contacted"), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });
});

describe("useCampaignWorkflowCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock(workflowsData));
  });

  it("counts workflows per stage for a campanha", async () => {
    const { result } = renderHook(() => useCampaignWorkflowCounts("camp-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data["contacted"]).toEqual({ total: 1, active: 1 });
  });

  it("is disabled when campanhaId is undefined", async () => {
    const { result } = renderHook(() => useCampaignWorkflowCounts(undefined), { wrapper: createWrapper() });
    expect(result.current.isFetching).toBe(false);
  });
});

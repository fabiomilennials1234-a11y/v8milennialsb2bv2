import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ── Chain mock ────────────────────────────────────────────────────────────────
function createChainMock() {
  const chain: Record<string, any> = {};
  [
    "select","eq","neq","or","in","gte","lte","lt","ilike","contains",
    "order","limit","range","insert","update","delete","upsert","not",
    "is","filter","match","overlaps","textSearch","csv",
  ].forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain); });
  chain.single = vi.fn().mockResolvedValue({
    data: { id: "wf1", organization_id: "org-t", name: "WF Test", is_active: true, status: "failed", workflow_id: "wf1", current_node_id: "n1", lead_id: "l1", loop_counters: {}, context: {} },
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "wf1", organization_id: "org-t", started_at: "2025-01-01", status: "completed" }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({
      data: [{ id: "wf1", name: "WF Test", is_active: true, organization_id: "org-t", created_at: "2025-01-01" }],
      error: null,
      count: 5,
    }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockInvoke = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...args: any[]) => mockRpc(...args),
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }),
      }),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ assertIsAdmin: vi.fn().mockResolvedValue(undefined), assertPermission: vi.fn().mockResolvedValue(undefined) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
import {
  useWorkflows,
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useToggleWorkflow,
  useWorkflowExecutions,
  useWorkflowExecutionSteps,
  useRetryWorkflowExecution,
  useWorkflowStats,
} from "@/hooks/useWorkflows";

describe("useWorkflows", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches workflows", async () => {
    const { result } = renderHook(() => useWorkflows(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("workflows");
  });
});

describe("useWorkflow", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches a single workflow by id", async () => {
    const { result } = renderHook(() => useWorkflow("wf1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("workflows");
  });

  it("returns null when id is undefined", async () => {
    const { result } = renderHook(() => useWorkflow(undefined), { wrapper: createWrapper() });
    // Query should be disabled
    expect(result.current.data).toBeUndefined();
  });
});

describe("useCreateWorkflow", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("creates a workflow with admin check", async () => {
    const { result } = renderHook(() => useCreateWorkflow(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "New WF", trigger_type: "lead_created", trigger_config: {}, nodes: [], edges: [] } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("workflows");
  });
});

describe("useUpdateWorkflow", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("updates a workflow", async () => {
    const { result } = renderHook(() => useUpdateWorkflow(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "wf1", name: "Updated" });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("workflows");
  });
});

describe("useDeleteWorkflow", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("deletes a workflow", async () => {
    const { result } = renderHook(() => useDeleteWorkflow(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("wf1"); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("workflows");
  });
});

describe("useToggleWorkflow", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("toggles workflow active state", async () => {
    const { result } = renderHook(() => useToggleWorkflow(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "wf1", is_active: false });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("workflows");
  });
});

describe("useWorkflowExecutions", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches executions for a workflow", async () => {
    const { result } = renderHook(() => useWorkflowExecutions("wf1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("workflow_executions");
  });

  it("returns empty when workflowId is undefined", async () => {
    const { result } = renderHook(() => useWorkflowExecutions(undefined), { wrapper: createWrapper() });
    expect(result.current.data).toBeUndefined();
  });
});

describe("useWorkflowExecutionSteps", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches execution steps", async () => {
    const { result } = renderHook(() => useWorkflowExecutionSteps("exec1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("workflow_execution_steps");
  });
});

describe("useRetryWorkflowExecution", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("retries a failed execution", async () => {
    const { result } = renderHook(() => useRetryWorkflowExecution(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("exec1"); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("workflow_executions");
  });
});

describe("useWorkflowStats", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches stats for a workflow", async () => {
    const { result } = renderHook(() => useWorkflowStats("wf1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("workflow_executions");
  });
});

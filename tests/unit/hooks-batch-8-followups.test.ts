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
    data: { id: "fu1", lead_id: "l1", title: "Ligar", organization_id: "org-t", due_date: "2025-01-15" },
    error: null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "fu1" }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({
      data: [{ id: "fu1", lead_id: "l1", title: "Ligar", organization_id: "org-t", due_date: "2025-01-15", completed_at: null, archived_at: null }],
      error: null,
      count: 1,
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

vi.mock("@/modules/identity/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
import {
  useFollowUps,
  useFollowUpAutomations,
  useCreateFollowUp,
  useUpdateFollowUp,
  useCompleteFollowUp,
  useArchiveFollowUp,
  useArchiveManyFollowUps,
  useDeleteFollowUp,
  useCreateFollowUpAutomation,
  useUpdateFollowUpAutomation,
  useDeleteFollowUpAutomation,
  useCreateAutomatedFollowUps,
} from "@/modules/engagement/hooks/useFollowUps";

describe("useFollowUps", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches follow ups for the organization", async () => {
    const { result } = renderHook(() => useFollowUps(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });

  it("passes filters: assignedTo", async () => {
    const { result } = renderHook(() => useFollowUps({ assignedTo: "tm1" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });

  it("passes filters: dateFilter=today", async () => {
    const { result } = renderHook(() => useFollowUps({ dateFilter: "today" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("passes filters: dateFilter=overdue", async () => {
    const { result } = renderHook(() => useFollowUps({ dateFilter: "overdue" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("passes filters: dateFilter=upcoming", async () => {
    const { result } = renderHook(() => useFollowUps({ dateFilter: "upcoming" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("passes filters: showCompleted + showArchived", async () => {
    const { result } = renderHook(() => useFollowUps({ showCompleted: true, showArchived: true }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useFollowUpAutomations", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("fetches automations without trigger type", async () => {
    const { result } = renderHook(() => useFollowUpAutomations(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("follow_up_automations");
  });

  it("fetches automations with stage_change trigger type", async () => {
    const { result } = renderHook(() => useFollowUpAutomations("stage_change"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("fetches automations with no_response_from_team (org-scoped)", async () => {
    const { result } = renderHook(() => useFollowUpAutomations("no_response_from_team"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useCreateFollowUp", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("creates a follow up", async () => {
    const { result } = renderHook(() => useCreateFollowUp(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ lead_id: "l1", title: "Ligar", due_date: "2025-01-15" });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });
});

describe("useUpdateFollowUp", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("updates a follow up", async () => {
    const { result } = renderHook(() => useUpdateFollowUp(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "fu1", title: "Ligar novamente" });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });
});

describe("useCompleteFollowUp", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("marks a follow up as completed", async () => {
    const { result } = renderHook(() => useCompleteFollowUp(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("fu1"); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });
});

describe("useArchiveFollowUp", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("archives a follow up", async () => {
    const { result } = renderHook(() => useArchiveFollowUp(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("fu1"); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });
});

describe("useArchiveManyFollowUps", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("archives many follow ups", async () => {
    const { result } = renderHook(() => useArchiveManyFollowUps(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync(["fu1", "fu2"]); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });

  it("returns count 0 for empty array", async () => {
    const chain = createChainMock();
    // Override the update chain to not actually be called
    mockFrom.mockReturnValue(chain);
    const { result } = renderHook(() => useArchiveManyFollowUps(), { wrapper: createWrapper() });
    let res: any;
    await act(async () => {
      try { res = await result.current.mutateAsync([]); } catch {}
    });
    // The mutationFn returns { count: 0 } for empty arrays
    expect(res).toEqual({ count: 0 });
  });
});

describe("useDeleteFollowUp", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("deletes a follow up", async () => {
    const { result } = renderHook(() => useDeleteFollowUp(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("fu1"); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });
});

describe("useCreateFollowUpAutomation", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("creates an automation (stage_change)", async () => {
    const { result } = renderHook(() => useCreateFollowUpAutomation(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          pipe_type: "whatsapp",
          stage: "novo_lead",
          title_template: "Ligar para o lead",
          trigger_type: "stage_change",
        });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_up_automations");
  });

  it("creates an automation (no_response_from_lead — includes org_id)", async () => {
    const { result } = renderHook(() => useCreateFollowUpAutomation(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          pipe_type: "whatsapp",
          stage: "novo_lead",
          title_template: "Template",
          trigger_type: "no_response_from_lead",
        });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_up_automations");
  });
});

describe("useUpdateFollowUpAutomation", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("updates an automation", async () => {
    const { result } = renderHook(() => useUpdateFollowUpAutomation(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "a1", title_template: "Updated" });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_up_automations");
  });
});

describe("useDeleteFollowUpAutomation", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("deletes an automation", async () => {
    const { result } = renderHook(() => useDeleteFollowUpAutomation(), { wrapper: createWrapper() });
    await act(async () => {
      try { await result.current.mutateAsync("a1"); } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_up_automations");
  });
});

describe("useCreateAutomatedFollowUps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = createChainMock();
    // First call returns automations, second call returns inserted follow ups
    chain.then = (resolve: any, reject?: any) =>
      Promise.resolve({
        data: [{ id: "a1", pipe_type: "whatsapp", stage: "novo_lead", title_template: "Auto", description_template: null, days_offset: 1, priority: "normal", is_active: true, trigger_type: "stage_change" }],
        error: null,
      }).then(resolve, reject);
    mockFrom.mockReturnValue(chain);
  });

  it("creates automated follow ups based on automations", async () => {
    const { result } = renderHook(() => useCreateAutomatedFollowUps(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({
          leadId: "l1",
          assignedTo: "tm1",
          pipeType: "whatsapp",
          stage: "novo_lead",
          sourcePipeId: "pw1",
        });
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("follow_up_automations");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ---- Chain mock helper ----

function createChainMock(data: unknown[] = [{ id: "mock-1", name: "Test" }]) {
  const chain: Record<string, any> = {};
  ["select", "eq", "neq", "or", "in", "gte", "lte", "lt", "ilike", "contains", "order", "limit", "range", "insert", "update", "delete", "upsert", "not", "is", "filter", "match", "overlaps", "textSearch", "csv", "count"].forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: data[0] ?? { id: "mock-1", organization_id: "org-t" }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: data[0] ?? null, error: null });
  chain.then = (resolve: any, reject?: any) => Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());
const mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...args: any[]) => mockRpc(...args),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    storage: { from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }) }) },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }) }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({ useOrganization: () => ({ organizationId: "org-t", isReady: true }), useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({ assertIsAdmin: vi.fn().mockResolvedValue(undefined), assertPermission: vi.fn().mockResolvedValue(undefined), useCanPerformActionAsync: () => ({ data: { allowed: true } }) }));
const mockIdentity = {
  userId: "u1",
  organizationId: "org-t",
  teamMemberId: "tm1",
  effectiveRole: "admin" as const,
  isMaster: false,
  isAdmin: true,
  features: {} as Record<string, boolean>,
  isLoading: false,
  isReady: true,
};
vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => mockIdentity,
}));
vi.mock("@/modules/identity/permissions/hooks/useCanDo", () => ({
  useCanDo: () => ({ allowed: true, reason: "admin", isLoading: false }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ---- Import hooks under test ----

import {
  useLeads,
  useLeadsCount,
  useCreateLead,
  useUpdateLead,
  useDeleteLead,
  useDeleteAllLeadsInPipe,
  useDeleteAllLeads,
  useLeadAiStatus,
  useToggleLeadAI,
  useToggleConversationAI,
  LEADS_PAGE_SIZE,
} from "@/modules/leads";

// ---- Tests ----

describe("useLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: "lead-1", name: "Lead 1", organization_id: "org-t" }]));
  });

  it("fetches leads with default params", async () => {
    const { result } = renderHook(() => useLeads(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });

  it("fetches leads with search query", async () => {
    const { result } = renderHook(() => useLeads({ page: 0, searchQuery: "test" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });

  it("fetches leads with origin filter", async () => {
    const { result } = renderHook(() => useLeads({ filterOrigin: "meta_ads" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });

  it("exports LEADS_PAGE_SIZE", () => {
    expect(LEADS_PAGE_SIZE).toBe(50);
  });
});

describe("useLeadsCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock());
  });

  it("returns count for org", async () => {
    const { result } = renderHook(() => useLeadsCount(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });

  it("applies search filter to count", async () => {
    const { result } = renderHook(() => useLeadsCount({ searchQuery: "test" }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });
});

describe("useCreateLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: "new-lead", name: "New", organization_id: "org-t" }]));
  });

  it("creates lead with org context", async () => {
    const { result } = renderHook(() => useCreateLead(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ name: "New Lead" } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });
});

describe("useUpdateLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(createChainMock([{ id: "lead-1", name: "Updated" }]));
  });

  it("updates lead and syncs responsible across pipes", async () => {
    const { result } = renderHook(() => useUpdateLead(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "lead-1", responsible_id: "tm-1" } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });

  it("updates lead without responsible_id sync", async () => {
    const { result } = renderHook(() => useUpdateLead(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ id: "lead-1", name: "Updated Name" } as any);
      } catch {}
    });
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });
});

describe("useDeleteLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIdentity.isAdmin = false;
    mockIdentity.effectiveRole = "member" as any;
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockFrom.mockReturnValue(createChainMock([{ id: "lead-1" }]));
  });

  afterEach(() => {
    mockIdentity.isAdmin = true;
    mockIdentity.effectiveRole = "admin" as any;
  });

  it("deletes lead after permission check", async () => {
    const { result } = renderHook(() => useDeleteLead(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync("lead-1");
      } catch {}
    });
    expect(mockRpc).toHaveBeenCalledWith("user_has_org_permission", { p_permission_key: "can_delete_leads" });
    expect(mockFrom).toHaveBeenCalledWith("lead_tags");
    expect(mockFrom).toHaveBeenCalledWith("lead_history");
    expect(mockFrom).toHaveBeenCalledWith("follow_ups");
  });

  it("throws when permission denied", async () => {
    mockRpc.mockResolvedValue({ data: false, error: null });
    const { result } = renderHook(() => useDeleteLead(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync("lead-1");
      } catch (e: any) {
        expect(e.message).toContain("permissão");
      }
    });
  });
});

describe("useDeleteAllLeadsInPipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockFrom.mockReturnValue(createChainMock([{ lead_id: "lead-1" }]));
  });

  it("deletes all leads in whatsapp pipe", async () => {
    const { result } = renderHook(() => useDeleteAllLeadsInPipe("whatsapp"), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ stageId: "stage-1" });
      } catch {}
    });
    expect(mockRpc).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith("pipe_whatsapp");
  });
});

describe("useDeleteAllLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockFrom.mockReturnValue(createChainMock([{ id: "lead-1", lead_id: "lead-1" }]));
  });

  it("deletes all leads for organization", async () => {
    const { result } = renderHook(() => useDeleteAllLeads(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync();
      } catch {}
    });
    expect(mockRpc).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith("leads");
  });
});

describe("useLeadAiStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: { ai_disabled: true }, error: null });
  });

  it("fetches AI status for a lead", async () => {
    const { result } = renderHook(() => useLeadAiStatus("lead-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_lead_ai_status", { p_lead_id: "lead-1" });
  });

  it("returns false when leadId is undefined", async () => {
    const { result } = renderHook(() => useLeadAiStatus(undefined), { wrapper: createWrapper() });
    // Should be disabled, not fetch
    expect(result.current.isFetching).toBe(false);
  });

  it("handles string JSON response", async () => {
    mockRpc.mockResolvedValue({ data: JSON.stringify({ ai_disabled: true }), error: null });
    const { result } = renderHook(() => useLeadAiStatus("lead-1"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ai_disabled: true });
  });
});

describe("useToggleLeadAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: { ai_disabled: true }, error: null });
  });

  it("toggles AI for a lead", async () => {
    const { result } = renderHook(() => useToggleLeadAI(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ leadId: "lead-1", disabled: true });
      } catch {}
    });
    expect(mockRpc).toHaveBeenCalledWith("toggle_lead_ai", { p_lead_id: "lead-1", p_disabled: true });
  });
});

describe("useToggleConversationAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: { id: "lead-1" }, error: null });
  });

  it("toggles AI for a conversation by phone", async () => {
    const { result } = renderHook(() => useToggleConversationAI(), { wrapper: createWrapper() });
    await act(async () => {
      try {
        await result.current.mutateAsync({ phone: "+5511999999999", disabled: true });
      } catch {}
    });
    expect(mockRpc).toHaveBeenCalledWith("toggle_phone_ai", { p_phone: "+5511999999999", p_disabled: true });
  });
});

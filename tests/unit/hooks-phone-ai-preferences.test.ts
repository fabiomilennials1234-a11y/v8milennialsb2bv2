/**
 * Hooks — phone_ai_preferences
 *
 * Coverage:
 *  - usePhoneAiStatus: calls get_phone_ai_status RPC, parses response.
 *  - useToggleConversationAI: calls toggle_phone_ai (not the removed
 *    toggle_conversation_ai), applies optimistic update on phone_ai_status
 *    cache, rolls back on error, confirms cache on success.
 *  - useToggleLeadAI: applies optimistic update on ["lead_ai_status", leadId]
 *    (previously missing — caused Switch to show stale state in chat), rolls
 *    back on error.
 *
 * These tests prove AC-01, AC-05, AC-08, AC-09 from the spec.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mockRpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: (...args: any[]) => mockRpc(...args),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
  },
}));

vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: { access_token: "tok" } }),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  assertIsAdmin: vi.fn().mockResolvedValue(undefined),
  assertPermission: vi.fn().mockResolvedValue(undefined),
  useCanPerformActionAsync: () => ({ data: { allowed: true } }),
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
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function createWrapper() {
  // gcTime 0 evicts cache entries that have no observers, which breaks
  // optimistic-update assertions (no useQuery observes lead_ai_status/
  // phone_ai_status in these tests). Use a long gcTime instead.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { wrapper, qc };
}

import {
  usePhoneAiStatus,
  useToggleConversationAI,
  useToggleLeadAI,
} from "@/modules/leads";

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: null, error: null });
});

// ───────────────────── usePhoneAiStatus ─────────────────────

describe("usePhoneAiStatus", () => {
  it("calls get_phone_ai_status RPC with the original phone string", async () => {
    mockRpc.mockResolvedValue({
      data: { ai_disabled: true, source: "preference", normalized_phone: "11987654321", lead_id: null },
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePhoneAiStatus("+55 11 98765-4321"), { wrapper });

    await waitFor(() => expect(result.current.data?.ai_disabled).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith("get_phone_ai_status", { p_phone: "+55 11 98765-4321" });
    expect(result.current.data?.source).toBe("preference");
  });

  it("does not call RPC when phone is null (query disabled)", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePhoneAiStatus(null), { wrapper });
    // Query is disabled when phone is null — data stays undefined, no RPC call.
    await new Promise((r) => setTimeout(r, 30));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("falls back gracefully when RPC returns error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePhoneAiStatus("11987654321"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.ai_disabled).toBe(false);
    expect(result.current.data?.source).toBe("error");
    errSpy.mockRestore();
  });
});

// ───────────────────── useToggleConversationAI ─────────────────────

describe("useToggleConversationAI", () => {
  it("calls toggle_phone_ai (not toggle_conversation_ai)", async () => {
    mockRpc.mockResolvedValue({
      data: { ai_disabled: true, lead_id: null, normalized_phone: "11987654321", affected_leads: 0 },
      error: null,
    });
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useToggleConversationAI(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ phone: "+5511987654321", disabled: true });
    });
    expect(mockRpc).toHaveBeenCalledWith("toggle_phone_ai", {
      p_phone: "+5511987654321",
      p_disabled: true,
    });
    // It must NOT call the removed RPC
    for (const call of mockRpc.mock.calls) {
      expect(call[0]).not.toBe("toggle_conversation_ai");
    }
  });

  it("applies optimistic update to phone_ai_status cache before RPC resolves", async () => {
    // Hold the RPC until we've asserted the optimistic update
    let resolveRpc: (v: any) => void = () => {};
    mockRpc.mockImplementation(() => new Promise((r) => { resolveRpc = r; }));

    const { wrapper, qc } = createWrapper();
    const { result } = renderHook(() => useToggleConversationAI(), { wrapper });

    const cacheKey = ["phone_ai_status", "org-t", "11987654321"];
    qc.setQueryData(cacheKey, { ai_disabled: false, source: "default" });

    await act(async () => {
      result.current.mutate({ phone: "11987654321", disabled: true });
      // Yield enough for onMutate to finish (it awaits several cancelQueries)
      await new Promise((r) => setTimeout(r, 30));
    });

    const cached = qc.getQueryData(cacheKey) as { ai_disabled: boolean } | undefined;
    expect(cached?.ai_disabled).toBe(true);

    // Unblock RPC to clean up
    resolveRpc({ data: { ai_disabled: true, lead_id: null }, error: null });
  });

  it("rolls back phone_ai_status cache when RPC fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom", code: "42P01" } });

    const { wrapper, qc } = createWrapper();
    const { result } = renderHook(() => useToggleConversationAI(), { wrapper });

    const cacheKey = ["phone_ai_status", "org-t", "11987654321"];
    qc.setQueryData(cacheKey, { ai_disabled: false, source: "default" });

    let threw = false;
    await act(async () => {
      try {
        await result.current.mutateAsync({ phone: "11987654321", disabled: true });
      } catch (_err) {
        threw = true;
      }
    });

    // Mutation propagated the error
    expect(threw).toBe(true);
    // Cache rolled back to its pre-optimistic value
    const cached = qc.getQueryData(cacheKey) as { ai_disabled: boolean };
    expect(cached.ai_disabled).toBe(false);
    errSpy.mockRestore();
  });

  it("reaffirms lead_ai_status cache on success when RPC returns lead_id", async () => {
    mockRpc.mockResolvedValue({
      data: { ai_disabled: true, lead_id: "lead-abc", normalized_phone: "11987654321", affected_leads: 1 },
      error: null,
    });

    const { wrapper, qc } = createWrapper();
    const { result } = renderHook(() => useToggleConversationAI(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ phone: "11987654321", disabled: true });
    });

    const leadStatus = qc.getQueryData(["lead_ai_status", "lead-abc"]) as { ai_disabled: boolean };
    expect(leadStatus?.ai_disabled).toBe(true);
  });
});

// ───────────────────── useToggleLeadAI optimistic lead_ai_status ─────────────

describe("useToggleLeadAI — optimistic update of lead_ai_status", () => {
  it("updates ['lead_ai_status', leadId] optimistically (fixes chat Switch stale state)", async () => {
    let resolveRpc: (v: any) => void = () => {};
    mockRpc.mockImplementation(() => new Promise((r) => { resolveRpc = r; }));

    const { wrapper, qc } = createWrapper();
    const { result } = renderHook(() => useToggleLeadAI(), { wrapper });

    const cacheKey = ["lead_ai_status", "lead-1"];
    qc.setQueryData(cacheKey, { ai_disabled: false });

    await act(async () => {
      result.current.mutate({ leadId: "lead-1", disabled: true });
      await new Promise((r) => setTimeout(r, 30));
    });

    // Seed was {ai_disabled:false}. After onMutate (which also reads
    // organizationId from useOrganization mock), cache should be flipped.
    const cached = qc.getQueryData(cacheKey) as { ai_disabled: boolean } | undefined;
    expect(cached).toBeDefined();
    expect(cached?.ai_disabled).toBe(true);

    resolveRpc({ data: { id: "lead-1", ai_disabled: true }, error: null });
  });

  it("rolls back ['lead_ai_status', leadId] on RPC failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "rls denied", code: "42501" } });

    const { wrapper, qc } = createWrapper();
    const { result } = renderHook(() => useToggleLeadAI(), { wrapper });

    const cacheKey = ["lead_ai_status", "lead-2"];
    qc.setQueryData(cacheKey, { ai_disabled: false });

    await act(async () => {
      try {
        await result.current.mutateAsync({ leadId: "lead-2", disabled: true });
      } catch {}
    });

    const cached = qc.getQueryData(cacheKey) as { ai_disabled: boolean };
    expect(cached.ai_disabled).toBe(false);
  });
});

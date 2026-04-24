/**
 * Regression: useFeaturePermissions DEVE enviar organization_id no body da
 * chamada a get-member-permissions. Sem isso, a edge function cai no
 * fallback "primeiro team_member por created_at" e avalia permissões contra
 * a org errada para usuários multi-org (incidente 2026-04-23 — funis
 * bloqueados para Weder/Milennials, Vagner, Mateus/Vanilla Brasil).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "jwt-token" } },
      }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
    })),
  },
}));

const mockUseAuth = vi.fn(() => ({ user: { id: "user-1" } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseCurrentTeamMember = vi.fn();
vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => mockUseCurrentTeamMember(),
}));

vi.mock("@/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({ isMaster: false, isLoading: false }),
}));

// Vite env vars used by the hook
vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");

import { useFeaturePermissions } from "@/hooks/useUserRole";

// ─── Helpers ──────────────────────────────────────────────────────────────

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ features: { "pipeline.view": true }, isAdmin: false, jobTitle: "", metricType: "meetings" }),
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe("useFeaturePermissions — multi-tenant body.organization_id", () => {
  it("sends organization_id from current team member in body (selected org)", async () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: "tm-selected", organization_id: "org-selected" },
    });

    const { result } = renderHook(() => useFeaturePermissions(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toEqual({ organization_id: "org-selected" });
  });

  it("sends the NEW org on switch (different queryKey → new fetch)", async () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: "tm-A", organization_id: "org-A" },
    });
    const { result, rerender } = renderHook(() => useFeaturePermissions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // user switches org
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: "tm-B", organization_id: "org-B" },
    });
    rerender();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));

    const firstCall = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const secondCall = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(firstCall.organization_id).toBe("org-A");
    expect(secondCall.organization_id).toBe("org-B");
  });

  it("does NOT fetch while team_member (and thus organization_id) is unknown", async () => {
    mockUseCurrentTeamMember.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useFeaturePermissions(), { wrapper: wrapper() });

    // give the effect a tick; still should not fire
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.isFetching).toBe(false);
  });

  it("sends X-User-JWT header with the access_token (never sends service key)", async () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: { id: "tm1", organization_id: "org-1" },
    });
    const { result } = renderHook(() => useFeaturePermissions(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-User-JWT"]).toBe("jwt-token");
    expect(headers.Authorization).toBe("Bearer anon-key");
  });
});

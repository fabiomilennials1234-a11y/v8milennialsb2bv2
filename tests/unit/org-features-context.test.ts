import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock Supabase RPC ──────────────────────────────────
const mockRpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// ─── Mock useOrganization ───────────────────────────────
let mockOrgReturn = {
  organizationId: "org-123" as string | null,
  isLoading: false,
};

vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => mockOrgReturn,
}));

// ─── Mock feature-registry types (only needed for TS) ───
vi.mock("@/modules/platform/lib/feature-registry", () => ({}));

// ─── Import module under test ───────────────────────────
import { OrgFeaturesProvider, useOrgFeatures } from "@/contexts/OrgFeaturesContext";

// ─── Helpers ────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function createWrapper(queryClient?: QueryClient) {
  const qc = queryClient ?? createQueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: qc },
      createElement(OrgFeaturesProvider, null, children)
    );
}

function makeFeaturesAndLimits(overrides: Record<string, unknown> = {}) {
  return {
    features: { copilot: true, leads: true, chat: false, campaigns_manual: true, campaigns_semi: false, campaigns_auto: true },
    limits: { max_leads: 500, max_users: 10, max_copilot_agents: 3 },
    plan_name: "pro",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────

describe("OrgFeaturesContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrgReturn = { organizationId: "org-123", isLoading: false };
    mockRpc.mockResolvedValue({ data: makeFeaturesAndLimits(), error: null });
  });

  // ── 1: Hook outside provider throws ───────────────────
  it("useOrgFeatures throws when used outside OrgFeaturesProvider", () => {
    expect(() => {
      renderHook(() => useOrgFeatures());
    }).toThrow("useOrgFeatures must be used within an OrgFeaturesProvider");
  });

  // ── 2: Returns defaults while loading ─────────────────
  it("returns permissive defaults while data is loading", () => {
    // Make the RPC hang so query stays loading
    mockRpc.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper() });

    // While loading, hasFeature returns true (permissive)
    expect(result.current.hasFeature("copilot" as any)).toBe(true);
    expect(result.current.hasFeature("nonexistent_feature" as any)).toBe(true);
    // checkLimit returns -1 (unlimited) while loading
    expect(result.current.checkLimit("max_leads" as any)).toBe(-1);
    // canCreateCampaign returns true while loading
    expect(result.current.canCreateCampaign("manual")).toBe(true);
    expect(result.current.canCreateCampaign("automatica")).toBe(true);
    // Plan name defaults to "free"
    expect(result.current.planName).toBe("free");
    // Loading state
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  // ── 3: Loads features and limits from RPC ─────────────
  it("loads features and limits from supabase RPC", async () => {
    const qc = createQueryClient();
    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(mockRpc).toHaveBeenCalledWith("org_get_features_and_limits", {
      p_org_id: "org-123",
    });

    // Features
    expect(result.current.hasFeature("copilot" as any)).toBe(true);
    expect(result.current.hasFeature("leads" as any)).toBe(true);
    expect(result.current.hasFeature("chat" as any)).toBe(false);

    // Limits
    expect(result.current.checkLimit("max_leads" as any)).toBe(500);
    expect(result.current.checkLimit("max_users" as any)).toBe(10);
    expect(result.current.checkLimit("max_copilot_agents" as any)).toBe(3);

    // Plan
    expect(result.current.planName).toBe("pro");
    expect(result.current.isLoading).toBe(false);
  });

  // ── 4: hasFeature returns false for missing feature ───
  it("hasFeature returns false for a feature not in the map", async () => {
    const qc = createQueryClient();
    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.hasFeature("nonexistent_feature" as any)).toBe(false);
  });

  // ── 5: checkLimit returns 0 for missing limit ────────
  it("checkLimit returns 0 for a limit not in the map", async () => {
    const qc = createQueryClient();
    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.checkLimit("nonexistent_limit" as any)).toBe(0);
  });

  // ── 6: canCreateCampaign checks correct feature keys ──
  it("canCreateCampaign checks the correct feature key for each campaign type", async () => {
    const qc = createQueryClient();
    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    // manual → campaigns_manual (true in mock)
    expect(result.current.canCreateCampaign("manual")).toBe(true);
    // semi_automatica → campaigns_semi (false in mock)
    expect(result.current.canCreateCampaign("semi_automatica")).toBe(false);
    // automatica → campaigns_auto (true in mock)
    expect(result.current.canCreateCampaign("automatica")).toBe(true);
  });

  // ── 7: canCreateCampaign returns true for unknown type ─
  it("canCreateCampaign returns true for an unknown campaign type", async () => {
    const qc = createQueryClient();
    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    // Unknown type has no mapped feature key → defaults to true
    expect(result.current.canCreateCampaign("unknown_type" as any)).toBe(true);
  });

  // ── 8: allFeatures and allLimits expose raw maps ──────
  it("exposes allFeatures and allLimits maps", async () => {
    const qc = createQueryClient();
    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

    await waitFor(() => expect(result.current.isReady).toBe(true));

    expect(result.current.allFeatures).toEqual({
      copilot: true,
      leads: true,
      chat: false,
      campaigns_manual: true,
      campaigns_semi: false,
      campaigns_auto: true,
    });
    expect(result.current.allLimits).toEqual({
      max_leads: 500,
      max_users: 10,
      max_copilot_agents: 3,
    });
  });

  // ── 9: Query is disabled when no organizationId ───────
  it("does not call RPC when organizationId is null", async () => {
    mockOrgReturn = { organizationId: null, isLoading: false };

    const qc = createQueryClient();
    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

    // Allow any microtasks to settle
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockRpc).not.toHaveBeenCalled();
    // Without data, defaults apply
    expect(result.current.planName).toBe("free");
    expect(result.current.allFeatures).toEqual({});
    expect(result.current.allLimits).toEqual({});
  });

  // ── 10: isLoading reflects org loading state ──────────
  it("isLoading is true when org is still loading", () => {
    mockOrgReturn = { organizationId: null, isLoading: true };
    mockRpc.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper() });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  // ── 11: RPC error causes query to fail gracefully ─────
  it("handles RPC error gracefully (uses defaults)", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("RPC failed") });

    const qc = createQueryClient();
    const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

    // The query will fail, but the context should still render with defaults
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Since data is null after error, defaults apply
    expect(result.current.planName).toBe("free");
    expect(result.current.allFeatures).toEqual({});
    expect(result.current.allLimits).toEqual({});
    // hasFeature still permissive when not ready
    expect(result.current.isReady).toBe(false);
    expect(result.current.hasFeature("copilot" as any)).toBe(true);
    expect(result.current.checkLimit("max_leads" as any)).toBe(-1);
  });
});

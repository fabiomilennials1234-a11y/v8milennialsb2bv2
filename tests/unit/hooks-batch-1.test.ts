/**
 * Batch test for multiple hooks — covers types, constants, and basic initialization.
 * Each hook import triggers coverage for its type declarations and exported constants.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// ── Global mocks for all hooks ──
const mockFrom = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        neq: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      }),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
      neq: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      gte: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      }),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  }),
  insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
  update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
  delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  upsert: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) },
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "test@t.com" } } }) },
  },
}));
vi.mock("@/modules/identity/auth/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: {} }) }));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-test", teamMemberId: "tm1", isReady: true }),
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-test", user_id: "u1", role: "admin" } }),
  isVirtualTeamMember: (id: string) => id?.startsWith("master-virtual-"),
}));
vi.mock("@/modules/identity/master/hooks/useMasterAuth", () => ({ useMasterAuth: () => ({ isMaster: false, isLoading: false }) }));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("@/modules/workflows/hooks/useAutoFollowUp", () => ({ triggerFollowUpAutomation: vi.fn() }));
vi.mock("@/modules/leads/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/lib/workflowTrigger", () => ({ triggerLeadCreatedInCustomPipeline: vi.fn() }));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  assertIsAdmin: vi.fn(),
  useCanPerformActionAsync: () => vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/modules/communication/lib/whatsapp", () => ({ formatPhoneForWhatsApp: (p: string) => p }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));
vi.mock("papaparse", () => ({ default: { parse: vi.fn() } }));

// ── Import hooks (each import triggers coverage) ──
import { useLeads, type LeadsFilterParams, type Lead } from "@/modules/leads";
import { usePipeConfirmacao } from "@/modules/pipelines/hooks/legacy/usePipeConfirmacao";
import { usePipePropostas } from "@/modules/pipelines/hooks/legacy/usePipePropostas";
import { usePipeWhatsapp } from "@/modules/pipelines/hooks/legacy/usePipeWhatsapp";
import { useDebounce } from "@/shared/hooks/useDebounce";
import { useLeadScore } from "@/modules/leads";
import { useLeadHistory } from "@/modules/leads";
import { useOrgQuotas } from "@/modules/identity/org-team/hooks/useOrgQuotas";
import { useOnboarding } from "@/modules/platform/hooks/useOnboarding";
import { useSeatUsage } from "@/modules/identity/org-team/hooks/useSeatUsage";

// ── Tests ──

describe("useLeads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("initializes without error", () => {
    const { result } = renderHook(() => useLeads(), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });

  it("accepts filter params", () => {
    const params: LeadsFilterParams = { page: 1, searchQuery: "test", filterOrigin: "meta_ads" };
    const { result } = renderHook(() => useLeads(params), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

describe("usePipeWhatsapp", () => {
  it("initializes without error", () => {
    const { result } = renderHook(() => usePipeWhatsapp(), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

describe("usePipeConfirmacao", () => {
  it("initializes without error", () => {
    const { result } = renderHook(() => usePipeConfirmacao(), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

describe("usePipePropostas", () => {
  it("initializes without error", () => {
    const { result } = renderHook(() => usePipePropostas(), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

describe("useDebounce", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("test", 300), { wrapper: createWrapper() });
    expect(result.current).toBe("test");
  });
});

describe("useLeadScore", () => {
  it("initializes without error", () => {
    const { result } = renderHook(() => useLeadScore("lead-1"), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

describe("useLeadHistory", () => {
  it("initializes without error", () => {
    const { result } = renderHook(() => useLeadHistory("lead-1"), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

describe("useOrgQuotas", () => {
  it("initializes without error", () => {
    const { result } = renderHook(() => useOrgQuotas(), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

describe("useOnboarding", () => {
  it("initializes without error", () => {
    const { result } = renderHook(() => useOnboarding(), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

describe("useSeatUsage", () => {
  it("initializes without error", () => {
    const { result } = renderHook(() => useSeatUsage(), { wrapper: createWrapper() });
    expect(result.current).toBeDefined();
  });
});

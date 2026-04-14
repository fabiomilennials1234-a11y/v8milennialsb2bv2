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
  chain.single = vi.fn().mockResolvedValue({ data: { id: "p1" }, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "p1" }, error: null });
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({
      data: [{
        id: "plan1",
        name: "pro",
        display_name: "Pro",
        description: "Pro plan",
        price_per_user_monthly: 99,
        base_price_monthly: null,
        min_users: 2,
        included_users: 0,
        included_copilots: 1,
        extra_user_price: 49,
        discount_semester_pct: 10,
        discount_annual_pct: 15,
        discount_volume_pct: 35,
        discount_volume_min: 10,
        features: { leads: true },
        position: 1,
        is_active: true,
      }],
      error: null,
    }).then(resolve, reject);
  chain.catch = (fn: any) => Promise.resolve({ data: [], error: null }).catch(fn);
  return chain;
}

const mockFrom = vi.fn().mockReturnValue(createChainMock());
const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockInvoke = vi.fn().mockResolvedValue({
  data: { payment_id: "pay1", status: "confirmed", qr_code: null, qr_code_payload: null },
  error: null,
});

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
      refreshSession: vi.fn().mockResolvedValue({}),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }),
      }),
    },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "u@t.com", user_metadata: { full_name: "User" } },
    session: { access_token: "tok" },
  }),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-t", isReady: true }),
  useRequiredOrganization: () => ({ organizationId: "org-t", teamMemberId: "tm1" }),
}));

// Mock react-router-dom useSearchParams
const mockSearchParams = new URLSearchParams();
vi.mock("react-router-dom", () => ({
  useSearchParams: () => [mockSearchParams],
}));

vi.mock("@/lib/pricing-calculator", () => ({
  calculatePricing: vi.fn().mockReturnValue({
    base_monthly: 198,
    volume_discount: 0,
    addons_monthly: 0,
    subtotal_monthly: 198,
    cycle_discount: 0,
    coupon_discount: 0,
    total_monthly: 198,
    total_cycle: 198,
    cycle_months: 1,
    savings: 0,
  }),
  formatBRL: vi.fn().mockImplementation((v: number) => `R$ ${v.toFixed(2)}`),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
import { useCheckout, formatBRL } from "@/hooks/useCheckout";

describe("useCheckout", () => {
  beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReturnValue(createChainMock()); });

  it("initializes with default state", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    // Wait for plans fetch
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    expect(result.current.state.step).toBe(1);
    expect(result.current.state.billing_cycle).toBe("monthly");
    expect(result.current.state.user_count).toBeGreaterThanOrEqual(1);
  });

  it("fetches plans from subscription_plans table", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    expect(mockFrom).toHaveBeenCalledWith("subscription_plans");
  });

  it("setStep changes the step", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    act(() => result.current.setStep(2));
    expect(result.current.state.step).toBe(2);
  });

  it("setBillingCycle changes the cycle", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    act(() => result.current.setBillingCycle("annual"));
    expect(result.current.state.billing_cycle).toBe("annual");
  });

  it("setTurboCount clamps between 0 and 10", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    act(() => result.current.setTurboCount(15));
    expect(result.current.state.turbo_count).toBe(10);
    act(() => result.current.setTurboCount(-5));
    expect(result.current.state.turbo_count).toBe(0);
  });

  it("applyCoupon and clearCoupon work", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    act(() => result.current.applyCoupon("CODE10", 10, "coupon-1"));
    expect(result.current.state.coupon_code).toBe("CODE10");
    expect(result.current.state.coupon_discount_pct).toBe(10);
    expect(result.current.state.coupon_id).toBe("coupon-1");
    act(() => result.current.clearCoupon());
    expect(result.current.state.coupon_code).toBe("");
    expect(result.current.state.coupon_discount_pct).toBe(0);
    expect(result.current.state.coupon_id).toBeNull();
  });

  it("setOrgName sets org name", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    act(() => result.current.setOrgName("Minha Empresa"));
    expect(result.current.state.org_name).toBe("Minha Empresa");
  });

  it("addTeamMember adds empty member", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    const initial = result.current.state.team_members.length;
    act(() => result.current.addTeamMember());
    expect(result.current.state.team_members.length).toBe(initial + 1);
  });

  it("removeTeamMember removes at index", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    act(() => result.current.addTeamMember());
    const afterAdd = result.current.state.team_members.length;
    act(() => result.current.removeTeamMember(afterAdd - 1));
    expect(result.current.state.team_members.length).toBe(afterAdd - 1);
  });

  it("updateTeamMember updates name/email", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    act(() => result.current.updateTeamMember(0, "name", "Updated Name"));
    expect(result.current.state.team_members[0].name).toBe("Updated Name");
  });

  it("setTeamMembersCount pads or trims", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    act(() => result.current.setTeamMembersCount(5));
    expect(result.current.state.team_members.length).toBe(5);
    act(() => result.current.setTeamMembersCount(2));
    expect(result.current.state.team_members.length).toBe(2);
  });

  it("canGoToStep2 is based on plan selection", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    // Plans loaded and first plan selected by default
    expect(result.current.canGoToStep2).toBe(true);
  });

  it("canGoToStep3 requires org name >= 2 chars", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loadingPlans).toBe(false));
    expect(result.current.canGoToStep3).toBe(false);
    act(() => result.current.setOrgName("AB"));
    expect(result.current.canGoToStep3).toBe(true);
  });
});

describe("formatBRL (re-exported)", () => {
  it("is a function", () => {
    expect(typeof formatBRL).toBe("function");
  });
});

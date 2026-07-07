import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));
vi.mock("@/modules/identity/org-team/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-test" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useCommissions } from "@/modules/engagement/hooks/useCommissions";

function mockCommissionQuery(data: unknown[]) {
  // Chain auto-referente + thenable: suporta qualquer sequência de .eq
  // (org, source #994, month, year) em qualquer ordem, inclusive após .order.
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve, reject);
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue(chain),
  });
}

describe("useCommissions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches commissions", async () => {
    mockCommissionQuery([
      { id: "c1", team_member_id: "tm1", amount: 5000, type: "mrr", status: "pending" },
    ]);
    const { result } = renderHook(() => useCommissions(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toBeDefined(), { timeout: 2000 });
  });

  it("renders without crashing", () => {
    mockCommissionQuery([]);
    expect(() => renderHook(() => useCommissions(), { wrapper: createWrapper() })).not.toThrow();
  });
});

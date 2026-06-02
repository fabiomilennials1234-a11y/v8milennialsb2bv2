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
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data, error: null }),
          }),
        }),
        order: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
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

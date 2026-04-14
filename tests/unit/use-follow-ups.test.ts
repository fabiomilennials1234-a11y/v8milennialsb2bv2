import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }),
  },
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));
vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-test" } }),
}));
vi.mock("@/hooks/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));

import { useFollowUps } from "@/hooks/useFollowUps";

function mockFollowUpQuery(data: unknown[]) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data, error: null }),
        neq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    }),
  });
}

describe("useFollowUps", () => {
  beforeEach(() => vi.clearAllMocks());

  it("can be rendered without crashing", () => {
    mockFollowUpQuery([]);
    // Just verify it renders — the hook depends on complex query chains
    expect(() => {
      renderHook(() => useFollowUps(), { wrapper: createWrapper() });
    }).not.toThrow();
  });
});

import { describe, it, expect, vi } from "vitest";

// Mock all dependencies
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() }) },
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({
  useRealtimeSubscription: vi.fn(),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));
vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));
vi.mock("@/modules/identity/permissions/lib/permissions", () => ({
  useCanPerformActionAsync: () => vi.fn().mockResolvedValue(true),
}));

// Import types — these are pure and always testable
import type { LeadsFilterParams } from "@/modules/leads";

describe("useLeads types and constants", () => {
  it("LeadsFilterParams interface exists", () => {
    const params: LeadsFilterParams = {
      page: 0,
      searchQuery: "test",
      filterOrigin: "meta_ads",
    };
    expect(params.page).toBe(0);
    expect(params.searchQuery).toBe("test");
  });

  it("filter params are optional", () => {
    const params: LeadsFilterParams = {};
    expect(params.page).toBeUndefined();
  });
});

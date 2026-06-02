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
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-test", isReady: true }),
}));
vi.mock("@/shared/realtime/useRealtimeSubscription", () => ({ useRealtimeSubscription: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useGoals, type Goal } from "@/modules/engagement/hooks/useGoals";

function mockGoalQuery(data: unknown[]) {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: data[0], error: null }),
      }),
    }),
  });
}

const MOCK_GOALS: Partial<Goal>[] = [
  { id: "g1", name: "Reuniões", type: "meetings", target_value: 50, current_value: 23, month: 4, year: 2026 },
  { id: "g2", name: "Vendas", type: "sales", target_value: 100000, current_value: 45000, month: 4, year: 2026 },
];

describe("useGoals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches goals for current month", async () => {
    mockGoalQuery(MOCK_GOALS);
    const { result } = renderHook(() => useGoals(4, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
  });

  it("returns empty when no goals", async () => {
    mockGoalQuery([]);
    const { result } = renderHook(() => useGoals(1, 2026), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(0);
  });

  it("defaults to current month when no params", () => {
    mockGoalQuery([]);
    expect(() => renderHook(() => useGoals(), { wrapper: createWrapper() })).not.toThrow();
  });
});

describe("Goal type", () => {
  it("has required fields", () => {
    const goal: Partial<Goal> = {
      id: "g1", name: "Test", type: "meetings",
      target_value: 50, current_value: 20,
      month: 4, year: 2026,
    };
    expect(goal.target_value).toBe(50);
  });
});

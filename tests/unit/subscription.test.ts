import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      getUser: () => mockGetUser(),
    },
  },
}));

import { checkSubscription } from "@/modules/billing/lib/subscription";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkSubscription", () => {
  it("returns active status when RPC succeeds", async () => {
    mockRpc.mockResolvedValue({
      data: {
        status: "active",
        plan: "pro",
        expires_at: "2027-01-01",
        is_valid: true,
        days_remaining: 365,
        grace_remaining: null,
        is_overdue: false,
        is_blocked: false,
      },
      error: null,
    });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("active");
    expect(result.isValid).toBe(true);
    expect(result.plan).toBe("pro");
    expect(result.isBlocked).toBe(false);
  });

  it("returns trial status", async () => {
    mockRpc.mockResolvedValue({
      data: {
        status: "trial",
        plan: "trial",
        expires_at: "2026-05-01",
        is_valid: true,
        days_remaining: 14,
        is_overdue: false,
        is_blocked: false,
      },
      error: null,
    });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("trial");
    expect(result.daysRemaining).toBe(14);
  });

  it("returns overdue status", async () => {
    mockRpc.mockResolvedValue({
      data: {
        status: "overdue",
        plan: "pro",
        expires_at: "2026-03-01",
        is_valid: false,
        days_remaining: -10,
        grace_remaining: 5,
        is_overdue: true,
        is_blocked: false,
      },
      error: null,
    });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("overdue");
    expect(result.isOverdue).toBe(true);
    expect(result.graceRemaining).toBe(5);
  });

  it("returns blocked/expired fallback on RPC error", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "RPC failed" },
    });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("expired");
    expect(result.isValid).toBe(false);
    expect(result.isBlocked).toBe(true);
    expect(result.plan).toBeNull();
  });

  it("returns blocked/expired when data is null", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("expired");
    expect(result.isBlocked).toBe(true);
  });
});

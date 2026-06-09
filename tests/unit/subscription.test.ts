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

  it("fail-open: RPC error never blocks (status 'unknown', not 'expired')", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Connection terminated due to connection timeout" },
    });

    const result = await checkSubscription("org-123");
    // Regressão do incidente 2026-06-09 (Grafica Cauta): timeout de transporte
    // NÃO pode virar "Assinatura Expirada" para cliente pagante.
    expect(result.status).toBe("unknown");
    expect(result.status).not.toBe("expired");
    expect(result.isBlocked).toBe(false);
    expect(result.isValid).toBe(true);
    expect(result.plan).toBeNull();
  });

  it("retries the RPC before giving up on transport error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "timeout" } });

    await checkSubscription("org-123");
    // tentativa inicial + 2 retries (RPC_RETRY_DELAYS_MS.length === 2)
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });

  it("recovers if a retry succeeds after a transient error", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: "timeout" } })
      .mockResolvedValueOnce({
        data: {
          status: "active",
          plan: "pro",
          expires_at: "2027-01-01",
          is_valid: true,
          days_remaining: 365,
          is_overdue: false,
          is_blocked: false,
        },
        error: null,
      });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("active");
    expect(result.isBlocked).toBe(false);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it("fail-open: anomalous null data without error does not block", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("unknown");
    expect(result.isBlocked).toBe(false);
    // sem erro de transporte → não faz retry
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("regression: terminal status from DB still blocks", async () => {
    mockRpc.mockResolvedValue({
      data: {
        status: "suspended",
        plan: "pro",
        expires_at: "2026-01-01",
        is_valid: false,
        days_remaining: 0,
        is_overdue: false,
        is_blocked: true,
      },
      error: null,
    });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("suspended");
    expect(result.isBlocked).toBe(true);
  });

  it("regression: billing_override is sovereign (is_blocked false despite expired plan)", async () => {
    // org_get_subscription_status devolve is_blocked=false quando billing_override=true
    mockRpc.mockResolvedValue({
      data: {
        status: "active",
        plan: "torque-2.0",
        expires_at: "2126-05-26",
        billing_override: true,
        is_valid: true,
        days_remaining: 36500,
        is_overdue: false,
        is_blocked: false,
      },
      error: null,
    });

    const result = await checkSubscription("org-123");
    expect(result.isBlocked).toBe(false);
    expect(result.isValid).toBe(true);
  });
});

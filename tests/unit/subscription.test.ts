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

  // ADR-0038: falha de consulta não é assinatura vencida. Antes, o erro virava
  // `expired` + `isBlocked` e um cliente pagante via "assinatura bloqueada". O
  // guard continua fechando o acesso — mas diz que não conseguiu verificar.
  it("lança o erro da RPC em vez de inventar assinatura vencida", async () => {
    const rpcError = { message: "RPC failed", code: "57014", details: null, hint: null };
    mockRpc.mockResolvedValue({ data: null, error: rpcError });

    await expect(checkSubscription("org-123")).rejects.toBe(rpcError);
  });

  it("returns blocked/expired when data is null", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    const result = await checkSubscription("org-123");
    expect(result.status).toBe("expired");
    expect(result.isBlocked).toBe(true);
  });
});

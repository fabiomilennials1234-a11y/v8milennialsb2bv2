/**
 * Unit tests — useUpdateLead with `expectedUpdatedAt` optimistic lock (#307).
 *
 * When the caller passes `expectedUpdatedAt`, the supabase UPDATE
 * gets an extra `.eq("updated_at", expected)` filter. If the row was
 * touched in between (server returns 0 rows / PGRST116), we throw a
 * typed `OptimisticLockConflictError` the UI can catch + force refetch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// Recorder for the chained .eq() filter args on UPDATE.
const updateEqCalls: Array<[string, unknown]> = [];
let singleResolver: () => { data: unknown; error: unknown } = () => ({
  data: { id: "lead-1", updated_at: "2026-05-19T12:00:00Z" },
  error: null,
});

function buildUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn((col: string, val: unknown) => {
    updateEqCalls.push([col, val]);
    return chain;
  });
  chain.select = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(singleResolver()));
  return chain;
}

const updateChain = buildUpdateChain();

const mockFrom = vi.fn().mockImplementation(() => ({
  update: vi.fn().mockReturnValue(updateChain),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));

vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
  useRequiredOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm1", isReady: true }),
}));

vi.mock("@/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({ isMaster: false, isLoading: false }),
}));

vi.mock("@/hooks/useUserRole", () => ({
  useIsAdmin: () => ({ isAdmin: true }),
  useUserRole: () => ({ data: "admin" }),
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { useUpdateLead } from "@/hooks/useLeads";
import { OptimisticLockConflictError } from "@/lib/optimistic-lock";

describe("useUpdateLead — optimistic locking (#307)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateEqCalls.length = 0;
    singleResolver = () => ({
      data: { id: "lead-1", updated_at: "2026-05-19T12:30:00Z" },
      error: null,
    });
  });

  it("does NOT add updated_at filter when expectedUpdatedAt is omitted", async () => {
    const { result } = renderHook(() => useUpdateLead(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "lead-1", responsible_id: "tm-2" });
    });

    const cols = updateEqCalls.map((c) => c[0]);
    expect(cols).toContain("id");
    expect(cols).toContain("organization_id");
    expect(cols).not.toContain("updated_at");
  });

  it("adds .eq('updated_at', expected) when expectedUpdatedAt is passed", async () => {
    const { result } = renderHook(() => useUpdateLead(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: "lead-1",
        responsible_id: "tm-2",
        expectedUpdatedAt: "2026-05-19T12:00:00Z",
      });
    });

    const found = updateEqCalls.find((c) => c[0] === "updated_at");
    expect(found).toBeTruthy();
    expect(found![1]).toBe("2026-05-19T12:00:00Z");
  });

  it("throws OptimisticLockConflictError when server returns PGRST116", async () => {
    singleResolver = () => ({
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    });

    const { result } = renderHook(() => useUpdateLead(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          id: "lead-1",
          responsible_id: "tm-2",
          expectedUpdatedAt: "2026-05-19T11:00:00Z",
        });
      }),
    ).rejects.toBeInstanceOf(OptimisticLockConflictError);
  });

  it("rethrows non-conflict errors unchanged", async () => {
    singleResolver = () => ({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });

    const { result } = renderHook(() => useUpdateLead(), {
      wrapper: createWrapper(),
    });

    let captured: unknown;
    try {
      await act(async () => {
        await result.current.mutateAsync({
          id: "lead-1",
          responsible_id: "tm-2",
          expectedUpdatedAt: "2026-05-19T11:00:00Z",
        });
      });
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeTruthy();
    expect(captured).not.toBeInstanceOf(OptimisticLockConflictError);
  });
});

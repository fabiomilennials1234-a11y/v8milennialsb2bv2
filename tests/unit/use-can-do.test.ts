/**
 * Unit tests for useCanDo() hook.
 *
 * Verifies:
 *   1. Master always allowed (instant)
 *   2. Admin always allowed (instant)
 *   3. Member resolves from features cache
 *   4. Accepts both AppAction and FeatureKey
 *   5. Loading state blocks (fail-closed)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// ─── Mock useIdentity ────────────────────────────────────

const mockIdentity = {
  userId: "user-1",
  organizationId: "org-1",
  teamMemberId: "tm-1",
  effectiveRole: "admin" as "admin" | "member" | null,
  isMaster: false,
  isAdmin: true,
  features: { "leads.delete": true, "copilot.create": false } as Record<string, boolean>,
  isLoading: false,
  isReady: true,
};

vi.mock("@/modules/identity/auth/hooks/useIdentity", () => ({
  useIdentity: () => mockIdentity,
}));

import { useCanDo } from "@/modules/identity/hooks/useCanDo";

describe("useCanDo", () => {
  beforeEach(() => {
    mockIdentity.isMaster = false;
    mockIdentity.isAdmin = true;
    mockIdentity.effectiveRole = "admin";
    mockIdentity.features = { "leads.delete": true, "copilot.create": false };
    mockIdentity.isLoading = false;
    mockIdentity.isReady = true;
  });

  it("master is always allowed", () => {
    mockIdentity.isMaster = true;
    mockIdentity.effectiveRole = "admin";

    const { result } = renderHook(() => useCanDo("delete_lead"), {
      wrapper: createWrapper(),
    });

    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe("master");
    expect(result.current.isLoading).toBe(false);
  });

  it("admin is always allowed", () => {
    const { result } = renderHook(() => useCanDo("delete_lead"), {
      wrapper: createWrapper(),
    });

    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe("admin");
  });

  it("member with feature enabled is allowed", () => {
    mockIdentity.isAdmin = false;
    mockIdentity.effectiveRole = "member";

    const { result } = renderHook(() => useCanDo("delete_lead"), {
      wrapper: createWrapper(),
    });

    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe("feature:leads.delete");
  });

  it("member with feature disabled is denied", () => {
    mockIdentity.isAdmin = false;
    mockIdentity.effectiveRole = "member";

    const { result } = renderHook(() => useCanDo("manage_copilot"), {
      wrapper: createWrapper(),
    });

    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe("denied:copilot.create");
  });

  it("accepts direct feature key", () => {
    mockIdentity.isAdmin = false;
    mockIdentity.effectiveRole = "member";

    const { result } = renderHook(() => useCanDo("copilot.create"), {
      wrapper: createWrapper(),
    });

    expect(result.current.allowed).toBe(false);
  });

  it("loading state blocks — fail-closed", () => {
    mockIdentity.isLoading = true;
    mockIdentity.isReady = false;

    const { result } = renderHook(() => useCanDo("delete_lead"), {
      wrapper: createWrapper(),
    });

    expect(result.current.allowed).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it("member with missing feature key is denied (fail-closed)", () => {
    mockIdentity.isAdmin = false;
    mockIdentity.effectiveRole = "member";
    mockIdentity.features = {};

    const { result } = renderHook(() => useCanDo("delete_lead"), {
      wrapper: createWrapper(),
    });

    expect(result.current.allowed).toBe(false);
  });
});

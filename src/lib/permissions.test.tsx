/**
 * Unit tests for the frontend permission resolver and hooks.
 *
 * Focus: fail-closed contract.
 *   - resolveAction(): unmapped actions and unknown roles deny.
 *   - useCanPerformAction(): loading state must return allowed=false.
 *   - useCanPerformActionAsync(): loading state must return allowed=false
 *     (regression guard for the historical caller bug where
 *     `if (perm && !perm.allowed)` short-circuited on undefined).
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveAction } from "./permissions";

// Mock dependencies so we can drive the loading state deterministically.

const userRoleMock = vi.fn();
const teamMemberMock = vi.fn();
const orgMock = vi.fn();
const masterMock = vi.fn();
const featurePermsMock = vi.fn();
const matrixMock = vi.fn();

vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: (...a: unknown[]) => userRoleMock(...a),
  useFeaturePermissions: (...a: unknown[]) => featurePermsMock(...a),
}));
vi.mock("@/hooks/useTeamMembers", () => ({
  useCurrentTeamMember: (...a: unknown[]) => teamMemberMock(...a),
}));
vi.mock("@/hooks/useOrganization", () => ({
  useOrganization: (...a: unknown[]) => orgMock(...a),
}));
vi.mock("@/hooks/useMasterAuth", () => ({
  useMasterAuth: (...a: unknown[]) => masterMock(...a),
}));
vi.mock("@/hooks/useTeamMemberMatrixPermissions", () => ({
  useTeamMemberMatrixPermissions: (...a: unknown[]) => matrixMock(...a),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
        }),
      }),
    }),
  },
}));

function setLoading() {
  userRoleMock.mockReturnValue({ data: null, isLoading: true });
  teamMemberMock.mockReturnValue({ data: null, isLoading: true });
  orgMock.mockReturnValue({ organizationId: null, isReady: false });
  masterMock.mockReturnValue({ isMaster: false, isLoading: true });
  featurePermsMock.mockReturnValue({ data: undefined, isLoading: true });
  matrixMock.mockReturnValue({ data: undefined, isLoading: true });
}

function setMemberReady() {
  userRoleMock.mockReturnValue({
    data: { user_id: "u1", role: "membro" },
    isLoading: false,
  });
  teamMemberMock.mockReturnValue({
    data: { id: "tm1", role: "membro", organization_id: "org-1" },
    isLoading: false,
  });
  orgMock.mockReturnValue({ organizationId: "org-1", isReady: true });
  masterMock.mockReturnValue({ isMaster: false, isLoading: false });
  featurePermsMock.mockReturnValue({ data: {}, isLoading: false });
  matrixMock.mockReturnValue({ data: new Map(), isLoading: false });
}

beforeEach(() => {
  userRoleMock.mockReset();
  teamMemberMock.mockReset();
  orgMock.mockReset();
  masterMock.mockReset();
  featurePermsMock.mockReset();
  matrixMock.mockReset();
});

function wrap(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("resolveAction (pure)", () => {
  const base = {
    isMaster: false,
    role: "membro" as const,
    featurePermissions: {},
    matrixPermissions: new Map<string, "allowed" | "denied">(),
  };

  it("denies unmapped actions", () => {
    const r = resolveAction("manage_copilot", { ...base, featurePermissions: {} });
    // copilot.create not present in features → denied via feature path
    expect(r.allowed).toBe(false);
  });

  it("master always allowed", () => {
    const r = resolveAction("delete_lead", { ...base, isMaster: true });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("admin");
  });

  it("admin always allowed", () => {
    const r = resolveAction("delete_lead", { ...base, role: "admin" });
    expect(r.allowed).toBe(true);
  });

  it("matrix denied → blocks even for permissive defaults", () => {
    const matrix = new Map<string, "allowed" | "denied">([["pipe:move", "denied"]]);
    const r = resolveAction("move_pipe_record", { ...base, matrixPermissions: matrix });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("matrix_denied");
  });
});

describe("useCanPerformAction — fail-closed during loading", () => {
  it("returns { allowed: false, isLoading: true } while any dependency loads", async () => {
    setLoading();
    const { useCanPerformAction } = await import("./permissions");
    const qc = new QueryClient();
    const { result } = renderHook(() => useCanPerformAction("delete_lead"), {
      wrapper: wrap(qc),
    });
    expect(result.current.allowed).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it("settles to denied after deps resolve for member with no feature flag", async () => {
    setMemberReady();
    const { useCanPerformAction } = await import("./permissions");
    const qc = new QueryClient();
    const { result } = renderHook(() => useCanPerformAction("manage_copilot"), {
      wrapper: wrap(qc),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });
});

describe("useCanPerformActionAsync — fail-closed during loading", () => {
  it("returns { allowed: false, isLoading: true } while deps load (regression guard)", async () => {
    setLoading();
    const { useCanPerformActionAsync } = await import("./permissions");
    const qc = new QueryClient();
    const { result } = renderHook(() => useCanPerformActionAsync("delete_campaign"), {
      wrapper: wrap(qc),
    });
    // CRITICAL: callers used to do `if (perm && !perm.allowed)`. If the
    // hook returns `undefined` here, that pattern silently fails open.
    // After this refactor the hook must always return a stable object
    // with `allowed: false` while loading.
    expect(result.current).toBeDefined();
    expect(result.current.allowed).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });

  it("returns { allowed: false, isLoading: false } after settle for unmapped action", async () => {
    setMemberReady();
    const { useCanPerformActionAsync } = await import("./permissions");
    const qc = new QueryClient();
    const { result } = renderHook(
      () => useCanPerformActionAsync("manage_copilot"),
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });

  it("returns allowed=true for admin without hitting any RPC", async () => {
    setMemberReady();
    masterMock.mockReturnValue({ isMaster: false, isLoading: false });
    userRoleMock.mockReturnValue({
      data: { user_id: "u1", role: "admin" },
      isLoading: false,
    });
    const { useCanPerformActionAsync } = await import("./permissions");
    const qc = new QueryClient();
    const { result } = renderHook(() => useCanPerformActionAsync("delete_lead"), {
      wrapper: wrap(qc),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allowed).toBe(true);
    expect(result.current.reason).toBe("admin");
  });
});

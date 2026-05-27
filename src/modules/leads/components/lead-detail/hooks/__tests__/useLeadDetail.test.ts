/**
 * useLeadDetail — visibility branching via can_view_lead RPC (Issue #305).
 *
 * Contract:
 *   - leadId null → visibility 'loading'.
 *   - RPC exists  → loads lead, visibility 'exists'.
 *   - RPC not_found / deleted / permission_denied → skips the lead SELECT,
 *     surfaces visibility + (when applicable) deleted metadata.
 *
 * The pipeline/related fetches must also be gated on visibility 'exists'
 * so a deleted or cross-org lead never triggers a SELECT that the UI
 * has no reason to render.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../../tests/helpers/hook-test-utils";

// ── Mocks ──────────────────────────────────────────────────────────────────
const mockRpc = vi.fn();
const mockLeadsSelect = vi.fn();
const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === "leads") {
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: () => mockLeadsSelect(),
        }),
      }),
    };
  }
  // Pipeline queries — return empty arrays so the hook finishes.
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
  },
}));

vi.mock("@/hooks/useTrackView", () => ({
  useTrackView: vi.fn(),
}));

import { useLeadDetail } from "../useLeadDetail";

describe("useLeadDetail — visibility branching (#305)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeadsSelect.mockResolvedValue({
      data: {
        id: "lead-1",
        name: "Test Lead",
        organization_id: "org-1",
        lead_tags: [],
      },
      error: null,
    });
  });

  it("returns 'loading' visibility when leadId is null", () => {
    const { result } = renderHook(() => useLeadDetail(null, true), {
      wrapper: createWrapper(),
    });
    expect(result.current.visibility).toBe("loading");
    expect(result.current.lead).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("returns 'loading' visibility when isOpen is false", () => {
    const { result } = renderHook(() => useLeadDetail("lead-1", false), {
      wrapper: createWrapper(),
    });
    expect(result.current.visibility).toBe("loading");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("RPC 'exists' → loads lead and surfaces visibility='exists'", async () => {
    mockRpc.mockResolvedValue({
      data: [{ status: "exists", metadata: { organization_id: "org-1" } }],
      error: null,
    });

    const { result } = renderHook(() => useLeadDetail("lead-1", true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.visibility).toBe("exists");
    });

    expect(mockRpc).toHaveBeenCalledWith("can_view_lead", { p_lead_id: "lead-1" });
    expect(mockLeadsSelect).toHaveBeenCalled();
    expect(result.current.lead).toMatchObject({ id: "lead-1", name: "Test Lead" });
  });

  it("RPC 'not_found' → does NOT fetch the lead row", async () => {
    mockRpc.mockResolvedValue({
      data: [{ status: "not_found", metadata: {} }],
      error: null,
    });

    const { result } = renderHook(() => useLeadDetail("lead-1", true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.visibility).toBe("not_found");
    });

    expect(result.current.lead).toBeNull();
    expect(mockLeadsSelect).not.toHaveBeenCalled();
  });

  it("RPC 'deleted' → exposes deleted_at metadata, skips lead SELECT", async () => {
    const deletedAt = "2026-05-19T10:00:00Z";
    mockRpc.mockResolvedValue({
      data: [
        {
          status: "deleted",
          metadata: { deleted_at: deletedAt, deleted_by: "u9" },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useLeadDetail("lead-1", true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.visibility).toBe("deleted");
    });

    expect(result.current.lead).toBeNull();
    expect(result.current.metadata).toMatchObject({
      deleted_at: deletedAt,
      deleted_by: "u9",
    });
    expect(mockLeadsSelect).not.toHaveBeenCalled();
  });

  it("RPC 'permission_denied' → skips lead SELECT, no metadata leak", async () => {
    mockRpc.mockResolvedValue({
      data: [{ status: "permission_denied", metadata: {} }],
      error: null,
    });

    const { result } = renderHook(() => useLeadDetail("lead-1", true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.visibility).toBe("permission_denied");
    });

    expect(result.current.lead).toBeNull();
    expect(mockLeadsSelect).not.toHaveBeenCalled();
  });

  it("RPC supabase-js wrapping: single object instead of array also works", async () => {
    // Some supabase-js versions unwrap TABLE-returning RPCs.
    mockRpc.mockResolvedValue({
      data: { status: "exists", metadata: { organization_id: "org-1" } },
      error: null,
    });

    const { result } = renderHook(() => useLeadDetail("lead-1", true), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.visibility).toBe("exists");
    });
  });
});

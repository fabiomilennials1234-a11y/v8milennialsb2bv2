/**
 * Unit tests — useLogLeadAction tier-aware wrapper (Issue #310).
 *
 * Routing contract:
 *   Tier 1 (irreversible)  → lead_history insert.
 *   Tier 2 (default)       → lead_history insert.
 *   Tier 3 (telemetry off) → analytics.track() only; NO lead_history row.
 *
 * Default tier is 2 — calls without `tier` go to lead_history.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createWrapper } from "../helpers/hook-test-utils";

// ── Mock supabase: capture inserts, return team_member name lookup.
const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === "lead_history") {
    return { insert: (...args: unknown[]) => mockInsert(...args) };
  }
  // team_members .select('name').eq('user_id', ...).maybeSingle()
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { name: "Alice" },
          error: null,
        }),
      }),
    }),
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1", email: "alice@test.com" } },
      }),
    },
  },
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

// Capture track() calls.
const mockTrack = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...a: unknown[]) => mockTrack(...a),
}));

import { useLogLeadAction, type LeadActionType } from "@/modules/leads";

describe("LeadActionType", () => {
  it("includes core action types", () => {
    const actions: LeadActionType[] = [
      "lead_created",
      "stage_changed",
      "sdr_assigned",
      "closer_assigned",
      "field_updated",
      "note_added",
      "meeting_scheduled",
      "meeting_attended",
      "meeting_missed",
      "meeting_deleted",
      "proposal_created",
      "proposal_status_changed",
      "proposal_deleted",
      "product_linked",
      "followup_created",
      "followup_completed",
      "ai_toggled",
      "copilot_interaction",
    ];
    expect(actions).toHaveLength(18);
    expect(actions).toContain("lead_created");
    expect(actions).toContain("stage_changed");
    expect(actions).toContain("copilot_interaction");
  });
});

describe("useLogLeadAction — tier-aware routing (#310)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ data: null, error: null });
    mockTrack.mockReset();
  });

  it("defaults to Tier 2 → inserts into lead_history", async () => {
    const { result } = renderHook(() => useLogLeadAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current({
        leadId: "lead-1",
        action: "stage_changed",
        description: "moved to novo",
      });
    });

    expect(mockFrom).toHaveBeenCalledWith("lead_history");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("Tier 1 inserts into lead_history (irreversible audit)", async () => {
    const { result } = renderHook(() => useLogLeadAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current({
        leadId: "lead-1",
        action: "lead_created",
        description: "deleted lead",
        tier: 1,
      });
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertArg = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.action).toBe("lead_created");
    expect(insertArg.lead_id).toBe("lead-1");
    expect(insertArg.organization_id).toBe("org-1");
    expect(mockTrack).not.toHaveBeenCalled();
  });

  it("Tier 3 does NOT insert into lead_history — routes to track()", async () => {
    const { result } = renderHook(() => useLogLeadAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current({
        leadId: "lead-1",
        action: "field_updated",
        description: "rating changed",
        tier: 3,
        metadata: { from: 3, to: 4 },
      });
    });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledTimes(1);
    const trackArg = mockTrack.mock.calls[0][0] as Record<string, unknown>;
    expect(trackArg.event).toBe("lead_action_telemetry");
    expect(trackArg.organizationId).toBe("org-1");
    expect(trackArg.entityType).toBe("lead");
    expect(trackArg.entityId).toBe("lead-1");
    expect(trackArg.metadata).toMatchObject({
      action: "field_updated",
      description: "rating changed",
      from: 3,
      to: 4,
    });
  });

  it("metadata flows through into lead_history on Tier 1/2", async () => {
    const { result } = renderHook(() => useLogLeadAction(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current({
        leadId: "lead-1",
        action: "stage_changed",
        description: "moved",
        tier: 2,
        metadata: { from: "novo", to: "qualificado" },
      });
    });

    const insertArg = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.metadata).toEqual({ from: "novo", to: "qualificado" });
  });

  it("Tier 3 swallows track failures (fire-and-forget)", async () => {
    mockTrack.mockImplementation(() => {
      throw new Error("analytics down");
    });

    const { result } = renderHook(() => useLogLeadAction(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current({
          leadId: "lead-1",
          action: "note_added",
          description: "noop",
          tier: 3,
        });
      }),
    ).resolves.not.toThrow();

    expect(mockInsert).not.toHaveBeenCalled();
  });
});

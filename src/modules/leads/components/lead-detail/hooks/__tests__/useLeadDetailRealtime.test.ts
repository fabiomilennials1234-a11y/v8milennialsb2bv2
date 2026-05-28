/**
 * Unit tests — useLeadDetailRealtime (Issue #306).
 *
 * Contract:
 *   - When `isOpen` is false or `leadId` is null → no subscription registered.
 *   - When the modal stays open for >500ms → subscribes to the 6 relevant tables.
 *   - Each table uses the right filter (lead_id=eq.X for most;
 *     organization_id=eq.X for `pipe_proposta_items` which has no lead_id).
 *   - postgres_changes event → invalidates the right TanStack query keys.
 *   - Unmount → channel teardown handled by `useRealtimeChannel` itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../../../../tests/helpers/hook-test-utils";

// Capture every useRealtimeChannel call.
const channelCalls: Array<{ table: string; filter?: string; enabled: boolean; onEvent: (p: unknown) => void }> = [];

vi.mock("@/hooks/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: {
    table: string;
    filter?: string;
    enabled?: boolean;
    onEvent: (payload: unknown) => void;
  }) => {
    channelCalls.push({
      table: opts.table,
      filter: opts.filter,
      enabled: opts.enabled !== false,
      onEvent: opts.onEvent,
    });
    return { state: "joined" as const, diagnostics: [] };
  },
}));

const invalidateSpy = vi.fn();
vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: invalidateSpy }),
  };
});

import { useLeadDetailRealtime } from "../useLeadDetailRealtime";

describe("useLeadDetailRealtime — gated multi-table subscription (#306)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    channelCalls.length = 0;
    invalidateSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not subscribe when modal is closed", () => {
    renderHook(() => useLeadDetailRealtime("lead-1", false, "org-1"), {
      wrapper: createWrapper(),
    });
    // All 6 channels are registered but their `enabled` must be false.
    expect(channelCalls.length).toBeGreaterThan(0);
    for (const c of channelCalls) {
      expect(c.enabled).toBe(false);
    }
  });

  it("does not subscribe when leadId is null", () => {
    renderHook(() => useLeadDetailRealtime(null, true, "org-1"), {
      wrapper: createWrapper(),
    });
    for (const c of channelCalls) {
      expect(c.enabled).toBe(false);
    }
  });

  it("enables subscriptions only after the 500ms lazy delay", async () => {
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useLeadDetailRealtime("lead-1", open, "org-1"),
      {
        wrapper: createWrapper(),
        initialProps: { open: true },
      },
    );

    // Before 500ms elapse: every channel is registered but disabled.
    const before = channelCalls.filter((c) => c.enabled);
    expect(before.length).toBe(0);

    // After 500ms: every channel becomes enabled.
    await act(async () => {
      vi.advanceTimersByTime(550);
    });

    rerender({ open: true });
    const after = channelCalls.filter((c) => c.enabled);
    expect(after.length).toBeGreaterThanOrEqual(6);
  });

  it("subscribes to the 6 expected tables with the right filters", async () => {
    renderHook(() => useLeadDetailRealtime("lead-1", true, "org-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      vi.advanceTimersByTime(550);
    });

    const enabledCalls = channelCalls.filter((c) => c.enabled);
    const byTable = (t: string) => enabledCalls.find((c) => c.table === t);

    expect(byTable("leads")?.filter).toBe("id=eq.lead-1");
    expect(byTable("lead_history")?.filter).toBe("lead_id=eq.lead-1");
    expect(byTable("lead_comments")?.filter).toBe("lead_id=eq.lead-1");
    expect(byTable("lead_tags")?.filter).toBe("lead_id=eq.lead-1");
    expect(byTable("pipeline_entries")?.filter).toBe("lead_id=eq.lead-1");
    // pipe_proposta_items has no lead_id column — filter by org, dedupe client-side.
    expect(byTable("pipe_proposta_items")?.filter).toBe("organization_id=eq.org-1");
  });

  it("invalidates the lead_history query keys when a lead_history event fires", async () => {
    renderHook(() => useLeadDetailRealtime("lead-1", true, "org-1"), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      vi.advanceTimersByTime(550);
    });

    const historyCall = channelCalls
      .filter((c) => c.enabled)
      .find((c) => c.table === "lead_history");
    expect(historyCall).toBeTruthy();

    invalidateSpy.mockClear();
    act(() => {
      historyCall!.onEvent({ eventType: "INSERT", new: { lead_id: "lead-1" } });
    });

    // Invalidation is debounced 150ms to coalesce bulk updates.
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const calledKeys = invalidateSpy.mock.calls.map(
      (c) => (c[0] as { queryKey: unknown[] }).queryKey,
    );
    // Hook should invalidate both common naming conventions for backwards compat.
    expect(calledKeys).toEqual(
      expect.arrayContaining([
        ["lead-timeline", "lead-1"],
        ["lead_history", "lead-1"],
      ]),
    );
  });

  it("teardown leaves no enabled channels when leadId becomes null", async () => {
    const { rerender } = renderHook(
      ({ leadId }: { leadId: string | null }) =>
        useLeadDetailRealtime(leadId, true, "org-1"),
      {
        wrapper: createWrapper(),
        initialProps: { leadId: "lead-1" },
      },
    );

    await act(async () => {
      vi.advanceTimersByTime(550);
    });

    channelCalls.length = 0;
    rerender({ leadId: null });
    expect(channelCalls.every((c) => !c.enabled)).toBe(true);
  });
});

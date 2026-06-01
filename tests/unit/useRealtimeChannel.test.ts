import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── Mock Supabase channel ────────────────────────────────────────────────────


const { mockChannel, mockRemoveChannel, callbacks } = vi.hoisted(() => {
  const callbacks = {
    subscribe: null as any,
    postgresChanges: null as any,
  };
  const mockRemoveChannel = vi.fn();
  const mockChannel: any = {
    on: vi.fn((_event: string, _config: any, cb: any) => {
      callbacks.postgresChanges = cb;
      return mockChannel;
    }),
    subscribe: vi.fn((cb?: any) => {
      if (cb) callbacks.subscribe = cb;
      return mockChannel;
    }),
    unsubscribe: vi.fn().mockResolvedValue("ok"),
  };
  return { mockChannel, mockRemoveChannel, callbacks };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: vi.fn(() => mockChannel),
    removeChannel: mockRemoveChannel,
  },
}));

vi.mock("@/lib/realtimeStatusStore", () => ({
  setChannelState: vi.fn(),
  incrementFailures: vi.fn().mockReturnValue(1),
  resetFailures: vi.fn(),
  openCircuitBreaker: vi.fn(),
  recordChannelEvent: vi.fn(),
}));

// ─── Import after mock ────────────────────────────────────────────────────────

import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitSubscribed() {
  callbacks.subscribe?.("SUBSCRIBED");
}

function emitError(msg = "connection lost") {
  callbacks.subscribe?.("CHANNEL_ERROR", new Error(msg));
}

function emitPostgresEvent(payload: any) {
  callbacks.postgresChanges?.(payload);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useRealtimeChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callbacks.subscribe = null;
    callbacks.postgresChanges = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Disabled → idle
  it("returns idle state and empty diagnostics when enabled=false", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        enabled: false,
      })
    );

    expect(result.current.state).toBe("idle");
    expect(result.current.diagnostics).toEqual([]);
    expect(mockChannel.subscribe).not.toHaveBeenCalled();
  });

  // 2. Mount → joining (via effect — initial render is idle, effect transitions)
  it("transitions to joining on mount when enabled", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
      })
    );

    expect(result.current.state).toBe("joining");
  });

  // 3. SUBSCRIBED → joined
  it("transitions to joined when channel emits SUBSCRIBED", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
      })
    );

    act(() => {
      emitSubscribed();
    });

    expect(result.current.state).toBe("joined");
    // diagnostics: idle→joining + joining→joined
    expect(result.current.diagnostics).toHaveLength(2);
    expect(result.current.diagnostics[1].newState).toBe("joined");
  });

  // 4. onEvent fires on postgres_changes
  it("fires onEvent callback when postgres_changes event arrives", () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent,
      })
    );

    act(() => {
      emitSubscribed();
    });

    const payload = { eventType: "INSERT", new: { id: "1" }, old: {} };
    act(() => {
      emitPostgresEvent(payload);
    });

    expect(onEvent).toHaveBeenCalledWith(payload);
  });

  // 5. CHANNEL_ERROR → errored
  it("transitions to errored on CHANNEL_ERROR", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
      })
    );

    act(() => {
      emitError("timeout");
    });

    expect(result.current.state).toBe("errored");
    // diagnostics: idle→joining + joining→errored
    expect(result.current.diagnostics).toHaveLength(2);
    expect(result.current.diagnostics[1].newState).toBe("errored");
    expect(result.current.diagnostics[1].error).toBe("timeout");
  });

  // 6. Circuit breaker opens after threshold errors → polling
  it("transitions to polling after threshold consecutive errors", () => {
    const threshold = 3;
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold, cooldownMs: 60_000 },
      })
    );

    act(() => {
      for (let i = 0; i < threshold; i++) {
        emitError(`err-${i}`);
      }
    });

    expect(result.current.state).toBe("polling");
    // Diagnostics should have entries for each error + the polling transition
    const pollingEntries = result.current.diagnostics.filter(
      (d) => d.newState === "polling"
    );
    expect(pollingEntries.length).toBeGreaterThanOrEqual(1);
  });

  // 7. Recovery: SUBSCRIBED after errors resets counter → joined
  it("resets failure counter on SUBSCRIBED and transitions to joined", () => {
    const threshold = 5;
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold },
      })
    );

    // Accumulate errors below threshold
    act(() => {
      for (let i = 0; i < threshold - 1; i++) {
        emitError(`err-${i}`);
      }
    });

    expect(result.current.state).toBe("errored");

    // Recovery
    act(() => {
      emitSubscribed();
    });

    expect(result.current.state).toBe("joined");

    // Now send threshold errors again — should take full threshold to trip
    act(() => {
      for (let i = 0; i < threshold; i++) {
        emitError(`err-${i}`);
      }
    });

    expect(result.current.state).toBe("polling");
  });

  // 8. Cleanup: unsubscribes and removes channel on unmount
  it("removes channel on unmount", () => {
    const { unmount } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
      })
    );

    unmount();

    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });

  // 9. Re-subscribes when table or filter changes
  it("re-subscribes when table changes", () => {
    const { rerender } = renderHook(
      (props: { table: string }) =>
        useRealtimeChannel({
          table: props.table,
          onEvent: vi.fn(),
        }),
      { initialProps: { table: "leads" } }
    );

    // First subscription
    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);

    // Change table → should remove old + create new
    rerender({ table: "conversations" });

    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(mockChannel.subscribe).toHaveBeenCalledTimes(2);
  });

  it("re-subscribes when filter changes", () => {
    const { rerender } = renderHook(
      (props: { filter?: string }) =>
        useRealtimeChannel({
          table: "leads",
          filter: props.filter,
          onEvent: vi.fn(),
        }),
      { initialProps: { filter: "organization_id=eq.abc" } }
    );

    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);

    rerender({ filter: "organization_id=eq.xyz" });

    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    expect(mockChannel.subscribe).toHaveBeenCalledTimes(2);
  });
});

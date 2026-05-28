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

// ─── Import after mock ────────────────────────────────────────────────────────

import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitSubscribed() {
  callbacks.subscribe?.("SUBSCRIBED");
}

function emitError(msg = "connection lost") {
  callbacks.subscribe?.("CHANNEL_ERROR", new Error(msg));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useRealtimeChannel — reconnect behaviors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callbacks.subscribe = null;
    callbacks.postgresChanges = null;
    vi.useFakeTimers();
    // Mock document.visibilityState
    Object.defineProperty(document, "visibilityState", {
      writable: true,
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── 1. After CHANNEL_ERROR, reconnect is scheduled (not immediate) ────────

  it("schedules reconnect after CHANNEL_ERROR (not immediate)", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold: 5, cooldownMs: 120_000 },
      })
    );

    const initialSubscribeCalls = mockChannel.subscribe.mock.calls.length;

    act(() => {
      emitError("timeout");
    });

    // Should NOT have re-subscribed immediately
    expect(mockChannel.subscribe.mock.calls.length).toBe(initialSubscribeCalls);
    expect(result.current.state).toBe("errored");

    // After backoff delay (1s for first failure), reconnect fires
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Should have triggered a reconnect (new subscribe call via epoch change)
    expect(mockChannel.subscribe.mock.calls.length).toBeGreaterThan(initialSubscribeCalls);
  });

  // ─── 2. Backoff delay follows formula: 1s, 2s, 4s, 8s, 16s, 30s (capped) ─

  it("backoff delay follows exponential formula capped at 30s", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold: 10, cooldownMs: 120_000 },
      })
    );

    const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000];

    for (let i = 0; i < expectedDelays.length; i++) {
      const callsBefore = mockChannel.subscribe.mock.calls.length;

      act(() => {
        emitError(`err-${i}`);
      });

      // Advance just short of the expected delay — should NOT reconnect yet
      act(() => {
        vi.advanceTimersByTime(expectedDelays[i] - 1);
      });
      expect(mockChannel.subscribe.mock.calls.length).toBe(callsBefore);

      // Advance the remaining 1ms — should reconnect now
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(mockChannel.subscribe.mock.calls.length).toBe(callsBefore + 1);

      // Emit error again for next iteration (the new subscribe triggered a new channel)
      // The subscribe callback is fresh from the new effect run
    }
  });

  // ─── 3. After circuit opens + cooldown, probe reconnect fires ──────────────

  it("probe reconnect fires after circuit opens + cooldown expires", () => {
    const threshold = 3;
    const cooldownMs = 10_000;

    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold, cooldownMs },
      })
    );

    // Trip circuit: emit threshold errors, advancing backoff between each
    for (let i = 0; i < threshold; i++) {
      act(() => {
        emitError(`err-${i}`);
      });
      // If not last error, advance past backoff so next error can come from new subscribe
      if (i < threshold - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        act(() => {
          vi.advanceTimersByTime(delay);
        });
      }
    }

    expect(result.current.state).toBe("polling");

    const callsBefore = mockChannel.subscribe.mock.calls.length;

    // Advance less than cooldown — no probe
    act(() => {
      vi.advanceTimersByTime(cooldownMs - 1);
    });
    expect(mockChannel.subscribe.mock.calls.length).toBe(callsBefore);

    // Advance remaining — probe fires
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mockChannel.subscribe.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // ─── 4. Probe success: closes circuit, resets failures → 'joined' ──────────

  it("probe success closes circuit and resets to joined", () => {
    const threshold = 3;
    const cooldownMs = 5_000;

    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold, cooldownMs },
      })
    );

    // Trip circuit
    for (let i = 0; i < threshold; i++) {
      act(() => {
        emitError(`err-${i}`);
      });
      if (i < threshold - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        act(() => {
          vi.advanceTimersByTime(delay);
        });
      }
    }

    expect(result.current.state).toBe("polling");

    // Wait for cooldown probe
    act(() => {
      vi.advanceTimersByTime(cooldownMs);
    });

    // Probe fires — emit SUBSCRIBED
    act(() => {
      emitSubscribed();
    });

    expect(result.current.state).toBe("joined");
  });

  // ─── 5. Probe failure: circuit stays open, cooldown restarts ───────────────

  it("probe failure keeps circuit open and restarts cooldown", () => {
    const threshold = 3;
    const cooldownMs = 5_000;

    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold, cooldownMs },
      })
    );

    // Trip circuit
    for (let i = 0; i < threshold; i++) {
      act(() => {
        emitError(`err-${i}`);
      });
      if (i < threshold - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 30000);
        act(() => {
          vi.advanceTimersByTime(delay);
        });
      }
    }

    expect(result.current.state).toBe("polling");

    // Wait for cooldown probe
    act(() => {
      vi.advanceTimersByTime(cooldownMs);
    });

    const callsAfterProbe = mockChannel.subscribe.mock.calls.length;

    // Probe fires but fails
    act(() => {
      emitError("probe-failed");
    });

    expect(result.current.state).toBe("polling");

    // Should schedule another cooldown — no reconnect before cooldown
    act(() => {
      vi.advanceTimersByTime(cooldownMs - 1);
    });
    expect(mockChannel.subscribe.mock.calls.length).toBe(callsAfterProbe);

    // After full cooldown, another probe fires
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mockChannel.subscribe.mock.calls.length).toBeGreaterThan(callsAfterProbe);
  });

  // ─── 6. Visibility change to 'visible' triggers reconnect ─────────────────

  it("visibility change to visible triggers reconnect when not joined", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold: 5, cooldownMs: 120_000 },
      })
    );

    // Put in errored state
    act(() => {
      emitError("lost");
    });

    expect(result.current.state).toBe("errored");

    const callsBefore = mockChannel.subscribe.mock.calls.length;

    // Simulate visibility change
    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should schedule reconnect (dedup window is 1s)
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockChannel.subscribe.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("visibility change does NOT trigger reconnect when already joined", () => {
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

    const callsBefore = mockChannel.subscribe.mock.calls.length;

    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockChannel.subscribe.mock.calls.length).toBe(callsBefore);
  });

  // ─── 7. Online event triggers reconnect when state !== 'joined' ────────────

  it("online event triggers reconnect when not joined", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold: 5, cooldownMs: 120_000 },
      })
    );

    // Put in errored state
    act(() => {
      emitError("offline");
    });

    expect(result.current.state).toBe("errored");

    const callsBefore = mockChannel.subscribe.mock.calls.length;

    // Simulate online event
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(mockChannel.subscribe.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // ─── 8. Rapid events within 1s are deduped ────────────────────────────────

  it("rapid visibility/online events within 1s are deduped to single reconnect", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold: 5, cooldownMs: 120_000 },
      })
    );

    // Put in errored state
    act(() => {
      emitError("lost");
    });

    // Clear backoff timer so we can isolate dedup behavior
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Now in errored state after backoff triggered reconnect
    // Emit another error to get back to errored
    act(() => {
      emitError("lost again");
    });

    const callsBefore = mockChannel.subscribe.mock.calls.length;

    // Fire multiple events rapidly
    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });

    // Advance past dedup window
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Should only have triggered ONE additional reconnect beyond the backoff one
    const callsAfter = mockChannel.subscribe.mock.calls.length;
    // At most 1 new subscribe from the deduped events
    expect(callsAfter - callsBefore).toBeLessThanOrEqual(1);
  });

  // ─── 9. All timers and listeners cleaned up on unmount ─────────────────────

  it("cleans up all timers and event listeners on unmount", () => {
    const removeVisibilitySpy = vi.spyOn(document, "removeEventListener");
    const removeOnlineSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold: 5, cooldownMs: 120_000 },
      })
    );

    // Put in errored state to start a timer
    act(() => {
      emitError("lost");
    });

    unmount();

    // Channel removed
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);

    // Visibility listener removed
    expect(removeVisibilitySpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function)
    );

    // Online listener removed
    expect(removeOnlineSpy).toHaveBeenCalledWith("online", expect.any(Function));

    // Advancing timers after unmount should not cause errors (timers cleared)
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
  });
});

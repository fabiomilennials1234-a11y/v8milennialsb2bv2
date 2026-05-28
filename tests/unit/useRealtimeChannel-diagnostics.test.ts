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

// ─── Mock realtimeStatusStore ────────────────────────────────────────────────

const mockSetChannelState = vi.fn();
const mockIncrementFailures = vi.fn().mockReturnValue(1);
const mockResetFailures = vi.fn();
const mockOpenCircuitBreaker = vi.fn();
const mockRecordChannelEvent = vi.fn();

vi.mock("@/lib/realtimeStatusStore", () => ({
  setChannelState: (...args: any[]) => mockSetChannelState(...args),
  incrementFailures: (...args: any[]) => mockIncrementFailures(...args),
  resetFailures: (...args: any[]) => mockResetFailures(...args),
  openCircuitBreaker: (...args: any[]) => mockOpenCircuitBreaker(...args),
  recordChannelEvent: (...args: any[]) => mockRecordChannelEvent(...args),
}));

// ─── Import after mocks ──────────────────────────────────────────────────────

import { useRealtimeChannel } from "@/shared/realtime/useRealtimeChannel";
import type { DiagnosticEvent } from "@/shared/realtime/useRealtimeChannel";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emitSubscribed() {
  callbacks.subscribe?.("SUBSCRIBED");
}

function emitError(msg = "connection lost") {
  callbacks.subscribe?.("CHANNEL_ERROR", new Error(msg));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useRealtimeChannel — diagnostics integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callbacks.subscribe = null;
    callbacks.postgresChanges = null;
    vi.useFakeTimers({ now: 1700000000000 });
    mockIncrementFailures.mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. State transition idle→joining records diagnostic event
  it("records diagnostic event on idle→joining transition", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        enabled: true,
      })
    );

    // Hook starts in joining state immediately
    expect(result.current.state).toBe("joining");

    // Should have a diagnostic for the joining transition
    const joiningEvents = result.current.diagnostics.filter(
      (d) => d.newState === "joining"
    );
    expect(joiningEvents.length).toBe(1);
    expect(joiningEvents[0].oldState).toBe("idle");
  });

  // 2. State transition joining→joined records event with correct shape
  it("records diagnostic event with full shape on joining→joined", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "conversations",
        onEvent: vi.fn(),
      })
    );

    act(() => {
      emitSubscribed();
    });

    const joinedEvents = result.current.diagnostics.filter(
      (d) => d.newState === "joined"
    );
    expect(joinedEvents.length).toBe(1);

    const evt = joinedEvents[0];
    expect(evt.oldState).toBe("joining");
    expect(evt.newState).toBe("joined");
    expect(evt.table).toBe("conversations");
    expect(evt.failureCount).toBe(0);
    expect(evt.channelName).toMatch(/^rt_conversations_/);
    expect(evt.error).toBeUndefined();
  });

  // 3. Diagnostic event includes timestamp, table, oldState, newState
  it("diagnostic events include timestamp, table, oldState, newState", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        filter: "organization_id=eq.abc",
        onEvent: vi.fn(),
      })
    );

    act(() => {
      emitSubscribed();
    });

    for (const evt of result.current.diagnostics) {
      expect(evt).toHaveProperty("timestamp");
      expect(typeof evt.timestamp).toBe("number");
      expect(evt).toHaveProperty("table");
      expect(evt.table).toBe("leads");
      expect(evt).toHaveProperty("oldState");
      expect(evt).toHaveProperty("newState");
    }
  });

  // 4. Circuit breaker open (state→polling) records "circuit_open" event
  it("records circuit_open event when circuit breaker trips", () => {
    const threshold = 3;
    mockIncrementFailures
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3);

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

    // Check that openCircuitBreaker was called on store
    expect(mockOpenCircuitBreaker).toHaveBeenCalledTimes(1);
    expect(mockOpenCircuitBreaker).toHaveBeenCalledWith(
      expect.stringMatching(/^rt_leads_/),
      expect.any(String)
    );

    // Check local diagnostic has circuit_open type
    const circuitEvents = result.current.diagnostics.filter(
      (d) => d.type === "circuit_open"
    );
    expect(circuitEvents.length).toBe(1);
    expect(circuitEvents[0].newState).toBe("polling");
  });

  // 5. Circuit breaker close (recovery after probe) records "circuit_close" event
  it("records circuit_close event when recovering from polling", () => {
    const threshold = 2;
    mockIncrementFailures
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2);

    const { result } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold, cooldownMs: 60_000 },
      })
    );

    // Trip the circuit breaker
    act(() => {
      for (let i = 0; i < threshold; i++) {
        emitError(`err-${i}`);
      }
    });
    expect(result.current.state).toBe("polling");

    // Recover
    act(() => {
      emitSubscribed();
    });

    expect(result.current.state).toBe("joined");

    // Check resetFailures was called on store
    expect(mockResetFailures).toHaveBeenCalled();

    // Check local diagnostic has circuit_close type
    const closeEvents = result.current.diagnostics.filter(
      (d) => d.type === "circuit_close"
    );
    expect(closeEvents.length).toBe(1);
    expect(closeEvents[0].oldState).toBe("polling");
    expect(closeEvents[0].newState).toBe("joined");
  });

  // 6. diagnostics in return value contains only events for this channel instance
  it("diagnostics contains only events for this channel instance", () => {
    const { result: resultA } = renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
      })
    );

    const { result: resultB } = renderHook(() =>
      useRealtimeChannel({
        table: "conversations",
        onEvent: vi.fn(),
      })
    );

    act(() => {
      emitSubscribed();
    });

    // Each hook has its own diagnostics array
    for (const evt of resultA.current.diagnostics) {
      expect(evt.table).toBe("leads");
    }
    for (const evt of resultB.current.diagnostics) {
      expect(evt.table).toBe("conversations");
    }
  });

  // 7. Events record to realtimeStatusStore
  it("reports state transitions to realtimeStatusStore", () => {
    renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
      })
    );

    // joining state should be reported
    expect(mockSetChannelState).toHaveBeenCalledWith(
      expect.stringMatching(/^rt_leads_/),
      "joining",
      undefined
    );

    act(() => {
      emitSubscribed();
    });

    // joined state should be reported
    expect(mockSetChannelState).toHaveBeenCalledWith(
      expect.stringMatching(/^rt_leads_/),
      "joined",
      undefined
    );
  });

  it("reports errors to realtimeStatusStore via incrementFailures", () => {
    renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
      })
    );

    act(() => {
      emitError("timeout");
    });

    expect(mockIncrementFailures).toHaveBeenCalledWith(
      expect.stringMatching(/^rt_leads_/),
      "timeout"
    );
  });

  it("calls setChannelState with polling when circuit opens", () => {
    const threshold = 2;
    mockIncrementFailures
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2);

    renderHook(() =>
      useRealtimeChannel({
        table: "leads",
        onEvent: vi.fn(),
        circuitBreaker: { threshold },
      })
    );

    act(() => {
      for (let i = 0; i < threshold; i++) {
        emitError(`err-${i}`);
      }
    });

    expect(mockSetChannelState).toHaveBeenCalledWith(
      expect.stringMatching(/^rt_leads_/),
      "polling",
      expect.any(String)
    );
  });
});

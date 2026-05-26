import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── Mock useRealtimeChannel ─────────────────────────────────────────────────

const mockUseRealtimeChannel = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useRealtimeChannel", () => ({
  useRealtimeChannel: mockUseRealtimeChannel,
}));

// ─── Mock useOrganization ────────────────────────────────────────────────────

const mockOrgId = "org-123-abc";
vi.mock("@/modules/identity/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: mockOrgId }),
}));

// ─── Mock TanStack Query ─────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn();
const mockSetQueriesData = vi.fn();
const mockQueryClient = {
  invalidateQueries: mockInvalidateQueries,
  setQueriesData: mockSetQueriesData,
};

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockQueryClient,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import type { RealtimeHandlers } from "@/hooks/useRealtimeSubscription";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function captureOnEvent(): (payload: any) => void {
  const lastCall = mockUseRealtimeChannel.mock.calls.at(-1);
  return lastCall?.[0]?.onEvent;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useRealtimeSubscription (refactored to delegate transport)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUseRealtimeChannel.mockReturnValue({ state: "joined", diagnostics: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── 1. Calls useRealtimeChannel with correct table and org filter ────────

  describe("transport delegation", () => {
    it("calls useRealtimeChannel with table and org-based filter", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      expect(mockUseRealtimeChannel).toHaveBeenCalledTimes(1);
      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.table).toBe("leads");
      expect(opts.filter).toBe(`organization_id=eq.${mockOrgId}`);
      expect(typeof opts.onEvent).toBe("function");
    });

    it("passes enabled=true when hook is called normally", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.enabled).toBe(true);
    });
  });

  // ─── 2. Tables without org_id get no filter ──────────────────────────────

  describe("TABLES_WITHOUT_ORG_ID", () => {
    it("team_members gets no org filter", () => {
      renderHook(() => useRealtimeSubscription("team_members", ["team_members"]));

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.filter).toBeUndefined();
    });

    it("user_roles gets no org filter", () => {
      renderHook(() => useRealtimeSubscription("user_roles", ["user_roles"]));

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.filter).toBeUndefined();
    });

    it("profiles gets no org filter", () => {
      renderHook(() => useRealtimeSubscription("profiles", ["profiles"]));

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.filter).toBeUndefined();
    });

    it("master_users gets no org filter", () => {
      renderHook(() => useRealtimeSubscription("master_users", ["master_users"]));

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.filter).toBeUndefined();
    });

    it("tags gets no org filter", () => {
      renderHook(() => useRealtimeSubscription("tags", ["tags"]));

      const opts = mockUseRealtimeChannel.mock.calls[0][0];
      expect(opts.filter).toBeUndefined();
    });
  });

  // ─── 3. INSERT → query key invalidation ──────────────────────────────────

  describe("INSERT event", () => {
    it("invalidates primary query key after debounce", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "INSERT", new: { id: "1" }, old: {} });
      });

      expect(mockInvalidateQueries).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["leads"], refetchType: "active" })
      );
    });

    it("invalidates secondary query keys after stagger delay", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads", "pipeline"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "INSERT", new: { id: "1" }, old: {} });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // First key invalidated
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Secondary key invalidated
      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["pipeline"], refetchType: "active" })
      );
    });
  });

  // ─── 4. UPDATE → surgical cache update ───────────────────────────────────

  describe("UPDATE event with handler", () => {
    it("applies surgical cache update via setQueriesData", () => {
      const onUpdate = vi.fn((updated: any, old: any[]) =>
        old.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );

      renderHook(() =>
        useRealtimeSubscription("leads", ["leads"], { onUpdate })
      );

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "1", name: "Updated" }, old: { id: "1" } });
      });

      expect(mockSetQueriesData).toHaveBeenCalledWith(
        { queryKey: ["leads"] },
        expect.any(Function)
      );
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it("surgical update calls handler with correct args", () => {
      const onUpdate = vi.fn((updated: any, old: any[]) =>
        old.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
      );

      renderHook(() =>
        useRealtimeSubscription("leads", ["leads"], { onUpdate })
      );

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "1", name: "New" }, old: { id: "1" } });
      });

      // Extract the updater function and call it
      const updaterFn = mockSetQueriesData.mock.calls[0][1];
      const result = updaterFn([{ id: "1", name: "Old" }, { id: "2", name: "Keep" }]);

      expect(onUpdate).toHaveBeenCalledWith(
        { id: "1", name: "New" },
        [{ id: "1", name: "Old" }, { id: "2", name: "Keep" }]
      );
      expect(result).toEqual([
        { id: "1", name: "New" },
        { id: "2", name: "Keep" },
      ]);
    });

    it("falls back to invalidation when no onUpdate handler", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "1" }, old: {} });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockInvalidateQueries).toHaveBeenCalled();
      expect(mockSetQueriesData).not.toHaveBeenCalled();
    });
  });

  // ─── 5. DELETE → surgical removal ────────────────────────────────────────

  describe("DELETE event with handler", () => {
    it("applies surgical cache removal via setQueriesData", () => {
      const onDelete = vi.fn((deleted: any, old: any[]) =>
        old.filter((item) => item.id !== deleted.id)
      );

      renderHook(() =>
        useRealtimeSubscription("leads", ["leads"], { onDelete })
      );

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "DELETE", new: {}, old: { id: "1" } });
      });

      expect(mockSetQueriesData).toHaveBeenCalledWith(
        { queryKey: ["leads"] },
        expect.any(Function)
      );
      expect(mockInvalidateQueries).not.toHaveBeenCalled();
    });

    it("falls back to invalidation when no onDelete handler", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "DELETE", new: {}, old: { id: "1" } });
      });

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(mockInvalidateQueries).toHaveBeenCalled();
      expect(mockSetQueriesData).not.toHaveBeenCalled();
    });
  });

  // ─── 6. Public interface unchanged ────────────────────────────────────────

  describe("public interface", () => {
    it("accepts (table, queryKeys) — no handlers", () => {
      // Must not throw
      const { result } = renderHook(() =>
        useRealtimeSubscription("leads", ["leads"])
      );
      expect(result.current).toBeUndefined(); // void return
    });

    it("accepts (table, queryKeys, handlers)", () => {
      const handlers: RealtimeHandlers = {
        onUpdate: (r, old) => old,
        onDelete: (r, old) => old,
      };
      const { result } = renderHook(() =>
        useRealtimeSubscription("leads", ["leads", "pipeline"], handlers)
      );
      expect(result.current).toBeUndefined(); // void return
    });
  });

  // ─── 7. Debounce: rapid events coalesced ──────────────────────────────────

  describe("debounce behavior", () => {
    it("multiple INSERT events within 2s produce single invalidation", () => {
      renderHook(() => useRealtimeSubscription("leads", ["leads"]));

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "INSERT", new: { id: "1" }, old: {} });
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      act(() => {
        onEvent({ eventType: "INSERT", new: { id: "2" }, old: {} });
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      act(() => {
        onEvent({ eventType: "INSERT", new: { id: "3" }, old: {} });
      });

      // Not yet fired
      expect(mockInvalidateQueries).not.toHaveBeenCalled();

      // Wait full debounce from last event
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Single invalidation
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    });

    it("surgical updates are NOT debounced (immediate)", () => {
      const onUpdate = vi.fn((u: any, old: any[]) =>
        old.map((i) => (i.id === u.id ? { ...i, ...u } : i))
      );

      renderHook(() =>
        useRealtimeSubscription("leads", ["leads"], { onUpdate })
      );

      const onEvent = captureOnEvent();
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "1", v: 1 }, old: {} });
      });
      act(() => {
        onEvent({ eventType: "UPDATE", new: { id: "2", v: 2 }, old: {} });
      });

      // Both applied immediately — no debounce
      expect(mockSetQueriesData).toHaveBeenCalledTimes(2);
    });
  });
});

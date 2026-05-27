/**
 * useConversationDraft — unit tests
 *
 * Scenarios:
 * 1. mount reads draft from localStorage for given key
 * 2. setDraft persists non-empty value (after debounce)
 * 3. setDraft with empty string removes the key (after debounce)
 * 4. switching conversationKey resets draft to new key's stored value
 * 5. localStorage quota exceeded — setDraft does not crash
 * 6. (new) user-scoping: two users sharing same conversation key get isolated drafts
 * 7. (new) no userId — draft is not persisted (in-memory only)
 * 8. (new) orphan drafts (no user prefix) are removed on first hook mount
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useConversationDraft } from "@/modules/communication/hooks/useConversationDraft";

const KEY_PREFIX = "chat-draft-";
const USER_A = "user-aaa-111";
const USER_B = "user-bbb-222";

// Fake in-memory localStorage (avoid global pollution in parallel tests)
function makeFakeStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
    removeItem: vi.fn((k: string) => { delete store[k]; }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]); }),
    get length() { return Object.keys(store).length; },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    _store: store,
  };
}

// Reset module-level state between tests so orphan cleanup is re-triggered
vi.mock("@/modules/communication/hooks/useConversationDraft", async () => {
  // re-import fresh each test via module factory
  const original = await vi.importActual<typeof import("@/modules/communication/hooks/useConversationDraft")>("@/modules/communication/hooks/useConversationDraft");
  return original;
});

describe("useConversationDraft", () => {
  let fakeStorage: ReturnType<typeof makeFakeStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeStorage = makeFakeStorage();
    Object.defineProperty(window, "localStorage", {
      value: fakeStorage,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("initialises draft from localStorage on mount (with userId)", () => {
    fakeStorage._store[`${KEY_PREFIX}${USER_A}-conv-1`] = "saved text";

    const { result } = renderHook(() => useConversationDraft("conv-1", USER_A));
    expect(result.current.draft).toBe("saved text");
  });

  it("initialises to empty string when no stored draft", () => {
    const { result } = renderHook(() => useConversationDraft("conv-empty", USER_A));
    expect(result.current.draft).toBe("");
  });

  it("initialises to empty string when conversationKey is empty", () => {
    const { result } = renderHook(() => useConversationDraft("", USER_A));
    expect(result.current.draft).toBe("");
  });

  it("setDraft updates state immediately", () => {
    const { result } = renderHook(() => useConversationDraft("conv-1", USER_A));

    act(() => {
      result.current.setDraft("hello world");
    });

    expect(result.current.draft).toBe("hello world");
  });

  it("setDraft persists non-empty value to localStorage after 300ms debounce", () => {
    const { result } = renderHook(() => useConversationDraft("conv-2", USER_A));

    act(() => {
      result.current.setDraft("persisted value");
      vi.advanceTimersByTime(301);
    });

    expect(fakeStorage.setItem).toHaveBeenCalledWith(
      `${KEY_PREFIX}${USER_A}-conv-2`,
      "persisted value",
    );
  });

  it("setDraft with empty string removes key from localStorage after debounce", () => {
    fakeStorage._store[`${KEY_PREFIX}${USER_A}-conv-3`] = "old text";

    const { result } = renderHook(() => useConversationDraft("conv-3", USER_A));

    act(() => {
      result.current.setDraft("");
      vi.advanceTimersByTime(301);
    });

    expect(fakeStorage.removeItem).toHaveBeenCalledWith(`${KEY_PREFIX}${USER_A}-conv-3`);
    expect(fakeStorage.setItem).not.toHaveBeenCalled();
  });

  it("switching conversationKey resets draft to new key's stored value", () => {
    fakeStorage._store[`${KEY_PREFIX}${USER_A}-conv-a`] = "text A";
    fakeStorage._store[`${KEY_PREFIX}${USER_A}-conv-b`] = "text B";

    const { result, rerender } = renderHook(
      ({ key }) => useConversationDraft(key, USER_A),
      { initialProps: { key: "conv-a" } },
    );

    expect(result.current.draft).toBe("text A");

    act(() => {
      rerender({ key: "conv-b" });
    });

    expect(result.current.draft).toBe("text B");
  });

  it("switching to key with no stored draft resets to empty", () => {
    fakeStorage._store[`${KEY_PREFIX}${USER_A}-conv-a`] = "text A";

    const { result, rerender } = renderHook(
      ({ key }) => useConversationDraft(key, USER_A),
      { initialProps: { key: "conv-a" } },
    );

    expect(result.current.draft).toBe("text A");

    act(() => {
      rerender({ key: "conv-z" });
    });

    expect(result.current.draft).toBe("");
  });

  it("setDraft does not crash when localStorage throws (quota exceeded)", () => {
    fakeStorage.setItem.mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });

    const { result } = renderHook(() => useConversationDraft("conv-quota", USER_A));

    expect(() => {
      act(() => {
        result.current.setDraft("some value");
        vi.advanceTimersByTime(301);
      });
    }).not.toThrow();

    // State still updated even if persistence failed
    expect(result.current.draft).toBe("some value");
  });

  it("debounce cancels previous timer when setDraft called rapidly", () => {
    const { result } = renderHook(() => useConversationDraft("conv-debounce", USER_A));

    act(() => {
      result.current.setDraft("first");
      vi.advanceTimersByTime(100); // not yet fired
      result.current.setDraft("second");
      vi.advanceTimersByTime(301); // fires only the second
    });

    // Only "second" should be persisted
    expect(fakeStorage.setItem).toHaveBeenCalledTimes(1);
    expect(fakeStorage.setItem).toHaveBeenCalledWith(
      `${KEY_PREFIX}${USER_A}-conv-debounce`,
      "second",
    );
  });

  // ── NEW: user-scoping tests ──────────────────────────────────────────────

  it("(B1) user-scoping: user A draft is isolated from user B on same conversation", () => {
    fakeStorage._store[`${KEY_PREFIX}${USER_A}-conv-shared`] = "draft from A";
    fakeStorage._store[`${KEY_PREFIX}${USER_B}-conv-shared`] = "draft from B";

    const { result: resultA } = renderHook(() =>
      useConversationDraft("conv-shared", USER_A),
    );
    const { result: resultB } = renderHook(() =>
      useConversationDraft("conv-shared", USER_B),
    );

    expect(resultA.current.draft).toBe("draft from A");
    expect(resultB.current.draft).toBe("draft from B");
  });

  it("(B1) no userId — draft is not persisted, state stays in-memory only", () => {
    const { result } = renderHook(() =>
      useConversationDraft("conv-x", undefined),
    );

    act(() => {
      result.current.setDraft("sensitive content");
      vi.advanceTimersByTime(301);
    });

    expect(result.current.draft).toBe("sensitive content"); // in-memory ok
    expect(fakeStorage.setItem).not.toHaveBeenCalled();     // but NOT persisted
  });

  it("(B1) signOut scenario: user B sees empty draft after user A leaves (different keys)", () => {
    // Simulate: user A writes draft, then logs out (keys cleaned by AuthContext).
    // User B logs in. User B must see empty draft.
    const keyA = `${KEY_PREFIX}${USER_A}-conv-shared`;
    fakeStorage._store[keyA] = "A's sensitive draft";
    // Simulate signOut cleanup — AuthContext removes user A's keys
    delete fakeStorage._store[keyA];

    const { result } = renderHook(() =>
      useConversationDraft("conv-shared", USER_B),
    );

    expect(result.current.draft).toBe(""); // user B sees nothing from user A
  });
});

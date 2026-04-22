/**
 * useConversationDraft — unit tests
 *
 * Scenarios:
 * 1. mount reads draft from localStorage for given key
 * 2. setDraft persists non-empty value (after debounce)
 * 3. setDraft with empty string removes the key (after debounce)
 * 4. switching conversationKey resets draft to new key's stored value
 * 5. localStorage quota exceeded — setDraft does not crash
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useConversationDraft } from "@/hooks/useConversationDraft";

const KEY_PREFIX = "chat-draft-";

// Fake in-memory localStorage (avoid global pollution in parallel tests)
function makeFakeStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => { store[k] = v; }),
    removeItem: vi.fn((k: string) => { delete store[k]; }),
    _store: store,
  };
}

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

  it("initialises draft from localStorage on mount", () => {
    fakeStorage._store[KEY_PREFIX + "conv-1"] = "saved text";

    const { result } = renderHook(() => useConversationDraft("conv-1"));
    expect(result.current.draft).toBe("saved text");
  });

  it("initialises to empty string when no stored draft", () => {
    const { result } = renderHook(() => useConversationDraft("conv-empty"));
    expect(result.current.draft).toBe("");
  });

  it("initialises to empty string when conversationKey is empty", () => {
    const { result } = renderHook(() => useConversationDraft(""));
    expect(result.current.draft).toBe("");
  });

  it("setDraft updates state immediately", () => {
    const { result } = renderHook(() => useConversationDraft("conv-1"));

    act(() => {
      result.current.setDraft("hello world");
    });

    expect(result.current.draft).toBe("hello world");
  });

  it("setDraft persists non-empty value to localStorage after 300ms debounce", async () => {
    const { result } = renderHook(() => useConversationDraft("conv-2"));

    act(() => {
      result.current.setDraft("persisted value");
      vi.advanceTimersByTime(301);
    });

    expect(fakeStorage.setItem).toHaveBeenCalledWith(
      KEY_PREFIX + "conv-2",
      "persisted value",
    );
  });

  it("setDraft with empty string removes key from localStorage after debounce", async () => {
    fakeStorage._store[KEY_PREFIX + "conv-3"] = "old text";

    const { result } = renderHook(() => useConversationDraft("conv-3"));

    act(() => {
      result.current.setDraft("");
      vi.advanceTimersByTime(301);
    });

    expect(fakeStorage.removeItem).toHaveBeenCalledWith(KEY_PREFIX + "conv-3");
    expect(fakeStorage.setItem).not.toHaveBeenCalled();
  });

  it("switching conversationKey resets draft to new key's stored value", () => {
    fakeStorage._store[KEY_PREFIX + "conv-a"] = "text A";
    fakeStorage._store[KEY_PREFIX + "conv-b"] = "text B";

    const { result, rerender } = renderHook(
      ({ key }) => useConversationDraft(key),
      { initialProps: { key: "conv-a" } },
    );

    expect(result.current.draft).toBe("text A");

    act(() => {
      rerender({ key: "conv-b" });
    });

    expect(result.current.draft).toBe("text B");
  });

  it("switching to key with no stored draft resets to empty", () => {
    fakeStorage._store[KEY_PREFIX + "conv-a"] = "text A";

    const { result, rerender } = renderHook(
      ({ key }) => useConversationDraft(key),
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

    const { result } = renderHook(() => useConversationDraft("conv-quota"));

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
    const { result } = renderHook(() => useConversationDraft("conv-debounce"));

    act(() => {
      result.current.setDraft("first");
      vi.advanceTimersByTime(100); // not yet fired
      result.current.setDraft("second");
      vi.advanceTimersByTime(301); // fires only the second
    });

    // Only "second" should be persisted
    expect(fakeStorage.setItem).toHaveBeenCalledTimes(1);
    expect(fakeStorage.setItem).toHaveBeenCalledWith(
      KEY_PREFIX + "conv-debounce",
      "second",
    );
  });
});

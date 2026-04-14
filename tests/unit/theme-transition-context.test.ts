import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

// ─── Mock next-themes ───────────────────────────────────
const mockSetTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: mockSetTheme,
    resolvedTheme: "dark",
  }),
}));

// ─── Mock framer-motion ─────────────────────────────────
// AnimatePresence and motion.div just render children / a div
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) =>
      createElement("div", { "data-testid": "motion-div" }, children as ReactNode),
  },
}));

// ─── Import module under test ───────────────────────────
import { ThemeTransitionProvider, useThemeTransition } from "@/contexts/ThemeTransitionContext";

// ─── Helpers ────────────────────────────────────────────

function createWrapper() {
  return ({ children }: { children: ReactNode }) =>
    createElement(ThemeTransitionProvider, null, children);
}

// ─── Tests ──────────────────────────────────────────────

describe("ThemeTransitionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.body.classList.remove("theme-transitioning");
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.classList.remove("theme-transitioning");
    document.documentElement.classList.remove("dark");
  });

  // ── 1: useThemeTransition returns null outside provider ─
  it("useThemeTransition returns null when used outside ThemeTransitionProvider", () => {
    const { result } = renderHook(() => useThemeTransition());
    expect(result.current).toBeNull();
  });

  // ── 2: Provider returns context with requestThemeChange ─
  it("provides requestThemeChange function inside provider", () => {
    const { result } = renderHook(() => useThemeTransition(), { wrapper: createWrapper() });
    expect(result.current).not.toBeNull();
    expect(typeof result.current!.requestThemeChange).toBe("function");
  });

  // ── 3: requestThemeChange("dark") applies dark class ───
  it('requestThemeChange("dark") calls setTheme and adds dark class after delay', () => {
    const { result } = renderHook(() => useThemeTransition(), { wrapper: createWrapper() });

    act(() => {
      result.current!.requestThemeChange("dark");
    });

    // body gets theme-transitioning class immediately
    expect(document.body.classList.contains("theme-transitioning")).toBe(true);

    // Advance to theme apply time (900ms)
    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  // ── 4: requestThemeChange("light") removes dark class ──
  it('requestThemeChange("light") calls setTheme and removes dark class after delay', () => {
    // Start with dark class present
    document.documentElement.classList.add("dark");

    const { result } = renderHook(() => useThemeTransition(), { wrapper: createWrapper() });

    act(() => {
      result.current!.requestThemeChange("light");
    });

    // Advance to theme apply time (900ms)
    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(mockSetTheme).toHaveBeenCalledWith("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  // ── 5: Transition completes and cleans up after DURATION_MS ─
  it("removes theme-transitioning class and clears overlay after full duration (1400ms)", () => {
    const { result } = renderHook(() => useThemeTransition(), { wrapper: createWrapper() });

    act(() => {
      result.current!.requestThemeChange("dark");
    });

    expect(document.body.classList.contains("theme-transitioning")).toBe(true);

    // Advance to full duration
    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(document.body.classList.contains("theme-transitioning")).toBe(false);
  });

  // ── 6: requestThemeChange("system") resolves based on matchMedia ─
  it('requestThemeChange("system") resolves to dark when prefers-color-scheme is dark', () => {
    // Mock matchMedia to return dark preference
    const mockMatchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, "matchMedia", { value: mockMatchMedia, writable: true });

    const { result } = renderHook(() => useThemeTransition(), { wrapper: createWrapper() });

    act(() => {
      result.current!.requestThemeChange("system");
    });

    // Advance to theme apply time
    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(mockSetTheme).toHaveBeenCalledWith("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  // ── 7: system theme resolves to light ────────────────
  it('requestThemeChange("system") resolves to light when prefers-color-scheme is light', () => {
    const mockMatchMedia = vi.fn().mockReturnValue({ matches: false });
    Object.defineProperty(window, "matchMedia", { value: mockMatchMedia, writable: true });

    document.documentElement.classList.add("dark");

    const { result } = renderHook(() => useThemeTransition(), { wrapper: createWrapper() });

    act(() => {
      result.current!.requestThemeChange("system");
    });

    // Advance to theme apply time
    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(mockSetTheme).toHaveBeenCalledWith("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  // ── 8: Rapid theme changes clear previous timers ─────
  it("clears previous timers when requestThemeChange is called again quickly", () => {
    const { result } = renderHook(() => useThemeTransition(), { wrapper: createWrapper() });

    // First request
    act(() => {
      result.current!.requestThemeChange("dark");
    });

    // Advance partway (500ms — not yet at theme apply time)
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Second request before first completes
    act(() => {
      result.current!.requestThemeChange("light");
    });

    // The first setTheme("dark") should not have fired (was at 900ms, cleared at 500ms)
    expect(mockSetTheme).not.toHaveBeenCalled();

    // Advance to the second request's apply time (900ms from second call)
    act(() => {
      vi.advanceTimersByTime(900);
    });

    expect(mockSetTheme).toHaveBeenCalledTimes(1);
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  // ── 9: Cleanup on unmount removes body class and timers ─
  it("cleans up body class and timers on unmount", () => {
    const { result, unmount } = renderHook(() => useThemeTransition(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current!.requestThemeChange("dark");
    });

    expect(document.body.classList.contains("theme-transitioning")).toBe(true);

    unmount();

    expect(document.body.classList.contains("theme-transitioning")).toBe(false);
  });

  // ── 10: Children are rendered inside the provider ─────
  it("renders children inside the provider", () => {
    const { result } = renderHook(() => useThemeTransition(), { wrapper: createWrapper() });

    // The hook should return a valid context value, proving children are rendered
    expect(result.current).not.toBeNull();
  });
});

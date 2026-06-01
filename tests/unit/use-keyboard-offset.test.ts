/**
 * useKeyboardOffset — TDD test suite
 *
 * Testa hook que calcula offset do teclado virtual iOS
 * usando window.visualViewport API.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: vi.fn(() => ({ isMobile: true, isDesktop: false, width: 375 })),
}));

import { useViewport } from "@/shared/hooks/use-viewport";
import { useKeyboardOffset } from "@/shared/hooks/use-keyboard-offset";

const mockUseViewport = vi.mocked(useViewport);

// ─── Helper: mock visualViewport ────────────────────────────────────────────

function mockVisualViewport(height: number) {
  const listeners: Record<string, Function[]> = {};
  const vv = {
    height,
    width: 375,
    offsetLeft: 0,
    offsetTop: 0,
    pageLeft: 0,
    pageTop: 0,
    scale: 1,
    addEventListener: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(window, "visualViewport", {
    value: vv,
    writable: true,
    configurable: true,
  });
  return {
    vv,
    triggerResize: (newHeight: number) => {
      vv.height = newHeight;
      listeners["resize"]?.forEach((cb) => cb());
    },
  };
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  Object.defineProperty(window, "innerHeight", {
    value: 812,
    writable: true,
    configurable: true,
  });
  mockUseViewport.mockReturnValue({ isMobile: true, isDesktop: false, width: 375 });
});

afterEach(() => {
  vi.restoreAllMocks();
  // limpa visualViewport
  Object.defineProperty(window, "visualViewport", {
    value: undefined,
    writable: true,
    configurable: true,
  });
});

// ─── Cycle 1: offset 0 quando teclado fechado ──────────────────────────────

describe("useKeyboardOffset", () => {
  it("retorna offset 0 quando teclado fechado (visualViewport.height === innerHeight)", () => {
    mockVisualViewport(812); // mesma altura = sem teclado

    const { result } = renderHook(() => useKeyboardOffset());

    expect(result.current.offset).toBe(0);
    expect(result.current.isKeyboardOpen).toBe(false);
  });

  // ─── Cycle 2: offset correto quando teclado aberto ─────────────────────

  it("retorna offset correto quando teclado abre (visualViewport.height < innerHeight)", () => {
    const { triggerResize } = mockVisualViewport(812);

    const { result } = renderHook(() => useKeyboardOffset());

    // Teclado abre — viewport encolhe pra 500
    act(() => {
      triggerResize(500);
    });

    expect(result.current.offset).toBe(312); // 812 - 500
    expect(result.current.isKeyboardOpen).toBe(true);
  });

  it("atualiza offset quando teclado fecha novamente", () => {
    const { triggerResize } = mockVisualViewport(500);

    const { result } = renderHook(() => useKeyboardOffset());

    expect(result.current.offset).toBe(312);
    expect(result.current.isKeyboardOpen).toBe(true);

    // Teclado fecha
    act(() => {
      triggerResize(812);
    });

    expect(result.current.offset).toBe(0);
    expect(result.current.isKeyboardOpen).toBe(false);
  });

  // ─── Cycle 3: offset 0 em desktop ──────────────────────────────────────

  it("retorna offset 0 em desktop (isMobile false)", () => {
    mockUseViewport.mockReturnValue({ isMobile: false, isDesktop: true, width: 1440 });
    mockVisualViewport(500); // viewport menor, mas desktop → ignorar

    const { result } = renderHook(() => useKeyboardOffset());

    expect(result.current.offset).toBe(0);
    expect(result.current.isKeyboardOpen).toBe(false);
  });

  // ─── Cycle 4: fallback sem visualViewport ──────────────────────────────

  it("retorna offset 0 quando visualViewport API nao disponivel", () => {
    // Nao chamar mockVisualViewport → fica undefined
    Object.defineProperty(window, "visualViewport", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardOffset());

    expect(result.current.offset).toBe(0);
    expect(result.current.isKeyboardOpen).toBe(false);
  });

  // ─── Cleanup: remove listeners on unmount ──────────────────────────────

  it("remove event listener ao desmontar", () => {
    const { vv } = mockVisualViewport(812);

    const { unmount } = renderHook(() => useKeyboardOffset());

    unmount();

    expect(vv.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });

  // ─── Edge: offset nunca negativo ───────────────────────────────────────

  it("retorna offset 0 se visualViewport.height > innerHeight (edge case)", () => {
    const { triggerResize } = mockVisualViewport(812);

    const { result } = renderHook(() => useKeyboardOffset());

    // viewport maior que inner (pode acontecer com zoom)
    act(() => {
      triggerResize(900);
    });

    expect(result.current.offset).toBe(0);
    expect(result.current.isKeyboardOpen).toBe(false);
  });
});

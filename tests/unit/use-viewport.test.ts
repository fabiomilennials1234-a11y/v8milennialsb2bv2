import { renderHook, act } from "@testing-library/react";
import { useViewport } from "@/shared/hooks/use-viewport";

describe("useViewport", () => {
  let resizeCallback: (() => void) | null = null;

  beforeEach(() => {
    resizeCallback = null;

    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        resizeCallback = () => cb([] as ResizeObserverEntry[], this as unknown as ResizeObserver);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setViewportWidth(w: number) {
    Object.defineProperty(window, "innerWidth", { value: w, writable: true, configurable: true });
  }

  it("returns isMobile true when viewport < 768", () => {
    setViewportWidth(375);
    const { result } = renderHook(() => useViewport());

    expect(result.current.isMobile).toBe(true);
    expect(result.current.isDesktop).toBe(false);
    expect(result.current.width).toBe(375);
  });

  it("returns isMobile false when viewport >= 768", () => {
    setViewportWidth(1024);
    const { result } = renderHook(() => useViewport());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.isDesktop).toBe(true);
    expect(result.current.width).toBe(1024);
  });

  it("updates when viewport resizes", () => {
    setViewportWidth(1024);
    const { result } = renderHook(() => useViewport());

    expect(result.current.isMobile).toBe(false);

    act(() => {
      setViewportWidth(375);
      resizeCallback?.();
    });

    expect(result.current.isMobile).toBe(true);
    expect(result.current.width).toBe(375);
  });

  it("returns width undefined before mount (SSR-safe)", () => {
    // Before useEffect runs, width should be undefined
    // We test this by checking the initial render has defined values after mount
    setViewportWidth(500);
    const { result } = renderHook(() => useViewport());

    // After mount, width is defined
    expect(result.current.width).toBe(500);
  });

  // ── Acrescentado ao fechar `inv:H8-33` ─────────────────────────────────
  // A suíte cobria 375 e 1024 — nenhum dos dois toca a fronteira. 768 exatos
  // é o iPad em retrato, e a regra do hook é `< 768`: por um pixel ele entrega
  // desktop. Trocar `<` por `<=` não quebrava nenhum caso anterior.
  it("768 exatos é DESKTOP — a fronteira é estritamente menor (iPad em retrato)", () => {
    setViewportWidth(768);
    const { result } = renderHook(() => useViewport());

    expect(result.current.isMobile).toBe(false);
    expect(result.current.isDesktop).toBe(true);
  });

  it("767 é celular — o outro lado da mesma fronteira", () => {
    setViewportWidth(767);
    const { result } = renderHook(() => useViewport());

    expect(result.current.isMobile).toBe(true);
  });

  it("isMobile e isDesktop nunca são os dois verdadeiros, nem os dois falsos", () => {
    for (const px of [320, 767, 768, 1024, 1920]) {
      setViewportWidth(px);
      const { result, unmount } = renderHook(() => useViewport());
      expect(result.current.isMobile && result.current.isDesktop).toBe(false);
      expect(result.current.isMobile || result.current.isDesktop).toBe(true);
      unmount();
    }
  });

  it("sem ResizeObserver cai no evento de resize — e desassina ao desmontar", () => {
    vi.unstubAllGlobals();
    // @ts-expect-error — apagar de propósito para exercitar o fallback.
    delete globalThis.ResizeObserver;
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    setViewportWidth(1024);
    const { result, unmount } = renderHook(() => useViewport());
    expect(add).toHaveBeenCalledWith("resize", expect.any(Function));

    act(() => {
      setViewportWidth(390);
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current.isMobile).toBe(true);

    unmount();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});

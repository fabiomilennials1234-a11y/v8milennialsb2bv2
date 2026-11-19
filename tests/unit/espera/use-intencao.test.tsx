import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIntencao } from "@/shared/espera";

describe("useIntencao", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dispara depois do atraso de intenção", () => {
    const acao = vi.fn();
    const { result } = renderHook(() => useIntencao(acao, 150));
    act(() => result.current.onMouseEnter());
    act(() => void vi.advanceTimersByTime(149));
    expect(acao).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it("passar por cima sem parar não dispara", () => {
    const acao = vi.fn();
    const { result } = renderHook(() => useIntencao(acao, 150));
    act(() => result.current.onMouseEnter());
    act(() => void vi.advanceTimersByTime(100));
    act(() => result.current.onMouseLeave());
    act(() => void vi.advanceTimersByTime(500));
    expect(acao).not.toHaveBeenCalled();
  });

  it("foco do teclado também é intenção", () => {
    const acao = vi.fn();
    const { result } = renderHook(() => useIntencao(acao, 80));
    act(() => result.current.onFocus());
    act(() => void vi.advanceTimersByTime(80));
    expect(acao).toHaveBeenCalledTimes(1);
  });

  it("nada em toque: mouseenter sintetizado após touchstart é ignorado", () => {
    const acao = vi.fn();
    const { result } = renderHook(() => useIntencao(acao, 150));
    act(() => {
      result.current.onTouchStart();
      result.current.onMouseEnter();
    });
    act(() => void vi.advanceTimersByTime(1000));
    expect(acao).not.toHaveBeenCalled();
  });

  it("desmontar cancela o pendente", () => {
    const acao = vi.fn();
    const { result, unmount } = renderHook(() => useIntencao(acao, 150));
    act(() => result.current.onMouseEnter());
    unmount();
    act(() => void vi.advanceTimersByTime(500));
    expect(acao).not.toHaveBeenCalled();
  });
});

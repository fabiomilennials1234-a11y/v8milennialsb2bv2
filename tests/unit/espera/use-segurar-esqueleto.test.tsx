/**
 * useSegurarEsqueleto — esqueleto que já nasce visível (o do Suspense que o
 * /chat mantém enquanto busca a lista) cumpre os 300 ms da régua antes de dar
 * lugar ao dado (qa Q3). Sem fase invisível: ele já está na tela.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REGUA, useSegurarEsqueleto } from "@/shared/espera";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSegurarEsqueleto", () => {
  it("dado que chega aos 40 ms: o esqueleto fica até completar 300 ms desde o primeiro quadro", () => {
    const { result, rerender } = renderHook(({ esperando }) => useSegurarEsqueleto(esperando), {
      initialProps: { esperando: true },
    });
    expect(result.current).toBe(false); // esperando: quem mostra o esqueleto é a espera
    act(() => void vi.advanceTimersByTime(40));
    rerender({ esperando: false });
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(REGUA.skeletonMinMs - 40 - 1));
    expect(result.current).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it("espera longa (> 300 ms): libera na hora em que o dado chega", () => {
    const { result, rerender } = renderHook(({ esperando }) => useSegurarEsqueleto(esperando), {
      initialProps: { esperando: true },
    });
    act(() => void vi.advanceTimersByTime(800));
    rerender({ esperando: false });
    expect(result.current).toBe(false);
  });

  it("dado já no cache na montagem: nunca segura", () => {
    const { result } = renderHook(() => useSegurarEsqueleto(false));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(REGUA.skeletonMinMs));
    expect(result.current).toBe(false);
  });

  it("depois de liberado, uma nova espera na mesma montagem não segura de novo", () => {
    const { result, rerender } = renderHook(({ esperando }) => useSegurarEsqueleto(esperando), {
      initialProps: { esperando: true },
    });
    rerender({ esperando: false });
    act(() => void vi.advanceTimersByTime(REGUA.skeletonMinMs));
    expect(result.current).toBe(false);
    rerender({ esperando: true });
    rerender({ esperando: false });
    expect(result.current).toBe(false);
  });
});

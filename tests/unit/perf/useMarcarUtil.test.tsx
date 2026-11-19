import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const registrarUtil = vi.fn();
const calcularUtil = vi.fn();
vi.mock("@/core/perf/medicao", () => ({
  registrarUtil: (...a: unknown[]) => registrarUtil(...a),
  calcularUtil: (...a: unknown[]) => calcularUtil(...a),
  instanteDaMedicao: () => performance.now(),
}));

import { useMarcarUtil } from "@/core/perf/useMarcarUtil";

describe("useMarcarUtil", () => {
  beforeEach(() => {
    registrarUtil.mockReset();
    calcularUtil.mockReset().mockReturnValue({ ms: 420, origem: "navegacao" });
  });

  it("não registra enquanto a tela não está pronta", () => {
    renderHook(() => useMarcarUtil("funil", false));
    expect(calcularUtil).not.toHaveBeenCalled();
    expect(registrarUtil).not.toHaveBeenCalled();
  });

  it("registra 1× na borda falso→verdadeiro, nunca de novo na mesma montagem", () => {
    const { rerender } = renderHook(({ pronto }) => useMarcarUtil("funil", pronto), {
      initialProps: { pronto: false },
    });
    rerender({ pronto: true });
    rerender({ pronto: false });
    rerender({ pronto: true });
    expect(registrarUtil).toHaveBeenCalledTimes(1);
    expect(registrarUtil).toHaveBeenCalledWith("funil", 420, "navegacao");
  });

  it("pronto já na montagem (cache quente) conta como útil imediato", () => {
    renderHook(() => useMarcarUtil("ficha_lead", true));
    expect(registrarUtil).toHaveBeenCalledTimes(1);
  });

  it("nova montagem mede de novo", () => {
    const a = renderHook(() => useMarcarUtil("chat", true));
    a.unmount();
    renderHook(() => useMarcarUtil("chat", true));
    expect(registrarUtil).toHaveBeenCalledTimes(2);
  });

  it("sem início conhecido (calcularUtil null) não grava", () => {
    calcularUtil.mockReturnValue(null);
    renderHook(() => useMarcarUtil("comando", true));
    expect(registrarUtil).not.toHaveBeenCalled();
  });

  it("passa o instante da montagem, anterior ao instante de pronto", () => {
    const { rerender } = renderHook(({ pronto }) => useMarcarUtil("funil", pronto), {
      initialProps: { pronto: false },
    });
    rerender({ pronto: true });
    const [montadoEm, instante] = calcularUtil.mock.calls[0] as [number, number];
    expect(montadoEm).toBeLessThanOrEqual(instante);
  });
});

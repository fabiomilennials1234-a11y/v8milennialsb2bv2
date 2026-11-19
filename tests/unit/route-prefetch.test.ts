import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  preCarregarRota,
  rastrearCarga,
  registrarRotas,
  useRotaPendente,
  __resetarRotasParaTestes,
} from "@/core/route-prefetch";

function conexao(c: Partial<{ saveData: boolean; effectiveType: string }> | undefined) {
  Object.defineProperty(navigator, "connection", { value: c, configurable: true });
}

describe("core/route-prefetch", () => {
  beforeEach(() => {
    __resetarRotasParaTestes();
    conexao(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("preCarregarRota é idempotente: um import por rota", async () => {
    const imp = vi.fn(() => Promise.resolve({ default: () => null }));
    registrarRotas({ "/dashboard": imp });
    preCarregarRota("/dashboard");
    preCarregarRota("/dashboard");
    preCarregarRota("/dashboard?x=1#y");
    await Promise.resolve();
    expect(imp).toHaveBeenCalledTimes(1);
  });

  it("casa rota com parâmetro (/funil/:slug)", () => {
    const imp = vi.fn(() => Promise.resolve({}));
    registrarRotas({ "/funil/:slug": imp });
    preCarregarRota("/funil/vendas");
    preCarregarRota("/funil/outro");
    expect(imp).toHaveBeenCalledTimes(1);
  });

  it("rota desconhecida não faz nada", () => {
    const imp = vi.fn(() => Promise.resolve({}));
    registrarRotas({ "/leads": imp });
    expect(() => preCarregarRota("/nada")).not.toThrow();
    expect(imp).not.toHaveBeenCalled();
  });

  it("ignora economia de dados e 2g", () => {
    const imp = vi.fn(() => Promise.resolve({}));
    registrarRotas({ "/leads": imp });
    conexao({ saveData: true });
    preCarregarRota("/leads");
    conexao({ effectiveType: "2g" });
    preCarregarRota("/leads");
    conexao({ effectiveType: "slow-2g" });
    preCarregarRota("/leads");
    expect(imp).not.toHaveBeenCalled();
    conexao({ effectiveType: "4g" });
    preCarregarRota("/leads");
    expect(imp).toHaveBeenCalledTimes(1);
  });

  it("falha no pré-carregamento libera nova tentativa", async () => {
    const imp = vi.fn().mockRejectedValueOnce(new Error("rede")).mockResolvedValue({});
    registrarRotas({ "/leads": imp });
    preCarregarRota("/leads");
    await new Promise((r) => setTimeout(r, 0));
    preCarregarRota("/leads");
    expect(imp).toHaveBeenCalledTimes(2);
  });

  it("useRotaPendente: falso com chunk rápido, verdadeiro com chunk lento > 100 ms", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRotaPendente());
    expect(result.current).toBe(false);

    let soltarRapido!: () => void;
    const rapido = rastrearCarga(new Promise<void>((r) => (soltarRapido = r)));
    act(() => void vi.advanceTimersByTime(60));
    await act(async () => {
      soltarRapido();
      await rapido;
    });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe(false);

    let soltarLento!: () => void;
    const lento = rastrearCarga(new Promise<void>((r) => (soltarLento = r)));
    act(() => void vi.advanceTimersByTime(99));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    await act(async () => {
      soltarLento();
      await lento;
    });
    expect(result.current).toBe(false);
  });

  it("rastrearCarga devolve o mesmo resultado e propaga a falha", async () => {
    await expect(rastrearCarga(Promise.resolve(42))).resolves.toBe(42);
    await expect(rastrearCarga(Promise.reject(new Error("x")))).rejects.toThrow("x");
  });
});

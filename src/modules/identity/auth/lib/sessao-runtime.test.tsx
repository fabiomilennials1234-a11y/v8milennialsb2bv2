import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { refreshSession: h.refresh } },
}));

import { instalarRecuperacaoDeSessao } from "./sessao-runtime";
import { useRecuperacaoDeSessao } from "../hooks/useRecuperacaoDeSessao";
import { CartaoRelogio } from "../components/AvisoRelogioDescompassado";

const VENCIDO = { code: "PGRST301", message: "JWT expired" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consulta que falha por token vencido se recupera sozinha", () => {
  it("renova a sessão e refaz a consulta — a tela recebe o dado, sem erro", async () => {
    h.refresh.mockResolvedValue({ data: { session: { access_token: "novo" } }, error: null });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const parar = instalarRecuperacaoDeSessao(qc);
    let chamadas = 0;
    const queryFn = vi.fn(async () => {
      chamadas += 1;
      if (chamadas === 1) throw VENCIDO;
      return "dados";
    });
    // Observada, como a tela que está mostrando a consulta.
    const observer = new QueryObserver(qc, { queryKey: ["team_member"], queryFn });
    const sair = observer.subscribe(() => {});
    await waitFor(() => expect(qc.getQueryData(["team_member"])).toBe("dados"));
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(queryFn).toHaveBeenCalledTimes(2);
    sair();
    parar();
  });

  it("erro que não é de token vencido não dispara renovação", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const parar = instalarRecuperacaoDeSessao(qc);
    const obs = qc.getQueryCache().build(qc, {
      queryKey: ["x"],
      queryFn: async () => {
        throw { code: "42501", message: "permission denied" };
      },
    });
    await obs.fetch().catch(() => undefined);
    expect(h.refresh).not.toHaveBeenCalled();
    parar();
  });
});

describe("useRecuperacaoDeSessao (abertura do app)", () => {
  it("token vencido: renova e refaz antes de mostrar erro", async () => {
    h.refresh.mockResolvedValue({ data: { session: {} }, error: null });
    const refazer = vi.fn();
    const { result } = renderHook(() => useRecuperacaoDeSessao(VENCIDO, refazer));
    expect(result.current).toBe("renovando");
    await waitFor(() => expect(refazer).toHaveBeenCalled());
  });

  it("renovação falhou (sessão de fato perdida): devolve 'falhou' e a tela de login aparece", async () => {
    h.refresh.mockResolvedValue({ data: { session: null }, error: { message: "Invalid Refresh Token" } });
    const { result } = renderHook(() => useRecuperacaoDeSessao({ ...VENCIDO }, vi.fn()));
    await waitFor(() => expect(result.current).toBe("falhou"));
  });

  it("erro que não é de token: nada a fazer", () => {
    const { result } = renderHook(() => useRecuperacaoDeSessao(new TypeError("Failed to fetch"), vi.fn()));
    expect(result.current).toBe("nada");
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe("aviso do relógio", () => {
  it("diz quanto está errado e fecha", () => {
    const onFechar = vi.fn();
    render(<CartaoRelogio defasagemMs={-12 * 60 * 1000} onFechar={onFechar} />);
    expect(screen.getByRole("status")).toHaveTextContent("O relógio deste computador está 12 min atrasado");
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso do relógio" }));
    expect(onFechar).toHaveBeenCalled();
  });
});

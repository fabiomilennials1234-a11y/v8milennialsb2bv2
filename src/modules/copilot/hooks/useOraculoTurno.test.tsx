/**
 * O turno do Oráculo, visto do navegador.
 *
 * A pergunta aparece na hora e a resposta chega do servidor: o cliente NUNCA
 * inventa a fala do assistente. É a mesma razão pela qual `oraculo_turns` não
 * é escrevível por `authenticated` — a procedência exibida ("consultei
 * métricas") tem que ser a que o servidor registrou, não a que a tela supôs.
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}));

import { useOraculoTurno } from "./useOraculoTurno";

const newQc = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const wrap = (qc: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    data: {
      conversa_id: "c-1",
      resposta: "Você fechou 3 vendas no período.",
      procedencia: ["metricas"],
      restantes_hoje: 24,
    },
    error: null,
  });
});

describe("useOraculoTurno", () => {
  it("mostra a pergunta na hora e anexa a resposta com a procedência que o servidor devolveu", async () => {
    const qc = newQc();
    const { result } = renderHook(() => useOraculoTurno(), { wrapper: wrap(qc) });

    act(() => { result.current.perguntar("quantas vendas eu fiz?"); });

    expect(result.current.mensagens.map((m) => m.content)).toEqual(["quantas vendas eu fiz?"]);

    await waitFor(() => expect(result.current.mensagens).toHaveLength(2));
    expect(result.current.mensagens[1]).toMatchObject({
      role: "assistant",
      content: "Você fechou 3 vendas no período.",
      procedencia: ["metricas"],
    });
    expect(result.current.conversaId).toBe("c-1");
  });

  it("no limite diário, diz o que houve em vez de falhar em silêncio", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: "limite_diario", context: { status: 429 } },
    });
    const qc = newQc();
    const { result } = renderHook(() => useOraculoTurno(), { wrapper: wrap(qc) });

    act(() => { result.current.perguntar("e agora?"); });

    await waitFor(() => expect(result.current.erro).toBeTruthy());
    expect(result.current.erro).toContain("limite");
    expect(result.current.mensagens.filter((m) => m.role === "assistant")).toHaveLength(0);
  });
});

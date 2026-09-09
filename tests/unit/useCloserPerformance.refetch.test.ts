import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Regressão ENG-USAB-2: as perf hooks (propostas/confirmacao) não tinham
// realtime nem invalidation; sem refetchInterval o TV dashboard congelava após uma
// venda. Este teste prova que o polling re-busca na cadência configurada.

// Os dois hooks leem a mesma projeção `negocio_projetado`; o que os distingue é o
// filtro `funil_sistema`. Contar por nome de tabela deixou de separar um do outro,
// então o espião registra o funil pedido em cada busca.
const funilSpy = vi.fn((_funil: string) => {});

const fromSpy = vi.fn((_table: string) => ({
  select: () => ({
    eq: (coluna: string, valor: string) => {
      if (coluna === "funil_sistema") funilSpy(valor);
      return { eq: () => Promise.resolve({ data: [], error: null }) };
    },
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}));

vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));

import {
  usePerfPipePropostas,
  usePerfPipeConfirmacao,
} from "@/modules/engagement/hooks/useCloserPerformance";

const REFETCH_INTERVAL = 30 * 1000;

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function countFor(funil: string) {
  return funilSpy.mock.calls.filter((c) => c[0] === funil).length;
}

describe("perf hooks — refetchInterval (TV dashboard não congela)", () => {
  beforeEach(() => {
    fromSpy.mockClear();
    funilSpy.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("usePerfPipePropostas re-busca na cadência do polling", async () => {
    renderHook(() => usePerfPipePropostas(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(0); // flush fetch inicial
    const initial = countFor("propostas");
    expect(initial).toBeGreaterThanOrEqual(1);
    // A dimensão que o recorte por funil não cobre: o hook tem que sair da
    // projeção canônica, não de um espelho. Sem isto o dublê aprovaria um
    // `.from("pipe_propostas").eq("funil_sistema", …)`, que nem existe.
    expect(fromSpy.mock.calls.every((c) => c[0] === "negocio_projetado")).toBe(true);

    await vi.advanceTimersByTimeAsync(REFETCH_INTERVAL);
    expect(countFor("propostas")).toBeGreaterThan(initial);
  });

  it("usePerfPipeConfirmacao re-busca na cadência do polling", async () => {
    renderHook(() => usePerfPipeConfirmacao(), { wrapper: createWrapper() });
    await vi.advanceTimersByTimeAsync(0);
    const initial = countFor("confirmacao");
    expect(initial).toBeGreaterThanOrEqual(1);
    expect(fromSpy.mock.calls.every((c) => c[0] === "negocio_projetado")).toBe(true);

    await vi.advanceTimersByTimeAsync(REFETCH_INTERVAL);
    expect(countFor("confirmacao")).toBeGreaterThan(initial);
  });
});

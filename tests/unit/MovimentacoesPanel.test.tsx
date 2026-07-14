import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ── jsdom polyfills p/ framer-motion / Radix ────────────────────────────────
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// ── Mocks ───────────────────────────────────────────────────────────────────
import {
  DEFAULT_MOVIMENTACOES_PERIOD,
  type MovimentacoesPeriodState,
} from "@/modules/analytics/lib/movimentacoes-period";

let periodState: MovimentacoesPeriodState = { ...DEFAULT_MOVIMENTACOES_PERIOD };
const setPeriod = vi.fn((next: MovimentacoesPeriodState) => {
  periodState = next;
});
vi.mock("@/shared/hooks/usePersistedState", () => ({
  usePersistedState: () => [periodState, setPeriod, vi.fn()],
}));

// count-up: identidade (sem animação) pra assertar o número final direto.
vi.mock("@/shared/hooks/useCountUp", () => ({
  useCountUp: (v: number) => v,
}));

const hookReturn = {
  marcadas: 0,
  comparecidas: 0,
  vendidoCount: 0,
  vendidoReceita: 0,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock("@/modules/analytics/hooks/useMovimentacoesPeriodo", () => ({
  useMovimentacoesPeriodo: () => hookReturn,
}));

import { MovimentacoesPanel } from "@/modules/analytics/components/performance/MovimentacoesPanel";

function reset(overrides: Partial<typeof hookReturn> = {}) {
  Object.assign(hookReturn, {
    marcadas: 0,
    comparecidas: 0,
    vendidoCount: 0,
    vendidoReceita: 0,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }, overrides);
}

describe("MovimentacoesPanel", () => {
  beforeEach(() => {
    periodState = { ...DEFAULT_MOVIMENTACOES_PERIOD };
    setPeriod.mockClear();
    reset();
  });

  it("título + presets sempre presentes", () => {
    render(<MovimentacoesPanel />);
    expect(screen.getByText("Movimentações no período")).toBeInTheDocument();
    ["Hoje", "7 dias", "30 dias", "Mês", "Custom"].forEach((l) =>
      expect(screen.getByRole("button", { name: l })).toBeInTheDocument(),
    );
  });

  it("estado loading: 3 skeletons, sem tiles", () => {
    reset({ isLoading: true });
    const { container } = render(<MovimentacoesPanel />);
    // header segue interativo mesmo carregando
    expect(screen.getByRole("button", { name: "Mês" })).toBeInTheDocument();
    expect(screen.queryByText("Marcadas")).not.toBeInTheDocument();
    // 3 skeletons (h-[92px])
    const skeletons = container.querySelectorAll(".h-\\[92px\\]");
    expect(skeletons.length).toBe(3);
  });

  it("estado erro: mensagem + botão que chama refetch", () => {
    const refetch = vi.fn();
    reset({ isError: true, refetch });
    render(<MovimentacoesPanel />);
    expect(
      screen.getByText("Não foi possível carregar as movimentações."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("estado zero: tiles com 0 + caption de vazio na primeira", () => {
    reset({ marcadas: 0, comparecidas: 0, vendidoCount: 0, vendidoReceita: 0 });
    render(<MovimentacoesPanel />);
    expect(screen.getByText("Marcadas")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma movimentação neste período.")).toBeInTheDocument();
  });

  it("estado com dados: números + receita cheia PT-BR no tile Vendido", () => {
    reset({ marcadas: 8, comparecidas: 5, vendidoCount: 12, vendidoReceita: 48500 });
    render(<MovimentacoesPanel />);

    // números dos tiles
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    // receita cheia (não compacta)
    expect(screen.getByText("R$ 48.500")).toBeInTheDocument();
    // sem caption de vazio quando há dados
    expect(
      screen.queryByText("Nenhuma movimentação neste período."),
    ).not.toBeInTheDocument();

    // a11y: aria-label do tile hero descreve vendas + receita
    expect(
      screen.getByRole("group", { name: "Vendido: 12 vendas, R$ 48.500 de receita" }),
    ).toBeInTheDocument();
  });

  it("clicar num preset persiste o novo preset", () => {
    render(<MovimentacoesPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    expect(setPeriod).toHaveBeenCalledWith(expect.objectContaining({ preset: "today" }));
  });
});

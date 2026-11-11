import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const estado = vi.hoisted(() => ({
  heatmap: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    isFetching: false,
    refetch: vi.fn(),
  },
}));
vi.mock("@/modules/analytics/hooks/useUfMap", () => ({
  useUfHeatmap: () => estado.heatmap,
  useLeadsByUf: () => ({ data: [], isLoading: false }),
}));

import { TabMapa } from "./TabMapa";

const montar = () =>
  render(
    <MemoryRouter>
      <TabMapa />
    </MemoryRouter>,
  );

beforeEach(() => {
  estado.heatmap = { data: undefined, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn() };
});

describe("TabMapa — estados do mapa", () => {
  it("erro: diz o que houve (sem permissão vira a mensagem do catálogo) e oferece tentar de novo", () => {
    estado.heatmap.isError = true;
    estado.heatmap.error = { message: "access_denied", code: "P0001", details: null, hint: null };
    montar();
    expect(screen.getByText("Não foi possível carregar o mapa")).toBeTruthy();
    expect(screen.getByText(/Você não tem permissão/)).toBeTruthy();
    expect(screen.queryByText(/leads mapeados/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(estado.heatmap.refetch).toHaveBeenCalledTimes(1);
  });

  it("vazio: o mapa fica, mas diz por que está cinza — sem inventar '0 sem estado'", () => {
    estado.heatmap.data = [];
    montar();
    expect(screen.getByRole("status").textContent).toContain("Nenhum lead com estado identificado ainda");
    expect(screen.queryByText(/sem estado identificado$/)).toBeNull();
  });

  it("com dados: soma os mapeados, mostra os sem estado e cita o ERP como fonte", () => {
    estado.heatmap.data = [
      { uf: "SC", leads_count: 6179, clients_count: 10, total_sold: 0, unmapped_count: 1673 },
      { uf: "SP", leads_count: 1718, clients_count: 2, total_sold: 0, unmapped_count: 1673 },
    ];
    montar();
    expect(screen.getByText("7.897 leads mapeados")).toBeTruthy();
    expect(screen.getByText("1.673 leads")).toBeTruthy();
    expect(screen.getByText(/Estado vem do cadastro do ERP/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("carregando: só o esqueleto", () => {
    estado.heatmap.isLoading = true;
    const { container } = montar();
    expect(screen.queryByText(/leads mapeados/)).toBeNull();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const estado = vi.hoisted(() => ({
  heatmap: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    isFetching: false,
    refetch: vi.fn(),
  },
  leads: {
    data: [] as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));
vi.mock("@/modules/analytics/hooks/useUfMap", () => ({
  useUfHeatmap: () => estado.heatmap,
  useLeadsByUf: () => estado.leads,
}));

import { TabMapa } from "./TabMapa";

function OndeEstou() {
  const { pathname, search } = useLocation();
  return <p>destino {pathname + search}</p>;
}

const montar = () =>
  render(
    <MemoryRouter initialEntries={["/metricas"]}>
      <Routes>
        <Route path="/metricas" element={<TabMapa />} />
        <Route path="/leads" element={<OndeEstou />} />
      </Routes>
    </MemoryRouter>,
  );

const SEM_REDE = { message: "TypeError: Failed to fetch", code: "", details: "", hint: "" };
const SEM_ACESSO = { message: "access_denied", code: "P0001", details: null, hint: null };
const linha = (uf: string, leads: number, extra: Partial<{ clients_count: number; total_sold: number }> = {}) => ({
  uf,
  leads_count: leads,
  clients_count: 0,
  total_sold: 0,
  unmapped_count: 1673,
  ...extra,
});

beforeEach(() => {
  estado.heatmap = { data: undefined, isLoading: false, isError: false, error: null, isFetching: false, refetch: vi.fn() };
  estado.leads = { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() };
});

describe("TabMapa — estados do mapa", () => {
  it("erro sem dado: diz o que houve e oferece tentar de novo", () => {
    estado.heatmap.isError = true;
    estado.heatmap.error = SEM_REDE;
    montar();
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar o mapa");
    expect(screen.getByText(/Sem conexão com o Torque/)).toBeTruthy();
    expect(screen.queryByText(/leads mapeados/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(estado.heatmap.refetch).toHaveBeenCalledTimes(1);
  });

  it("recusa (access_denied): diz que não há acesso e não oferece tentar de novo", () => {
    estado.heatmap.isError = true;
    estado.heatmap.error = SEM_ACESSO;
    montar();
    expect(screen.getByText("Sem acesso ao mapa")).toBeTruthy();
    expect(screen.getByText(/Você não tem permissão/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tentar de novo" })).toBeNull();
  });

  it("refetch falhou com a última carga em cache: o mapa fica e o aviso é discreto", () => {
    estado.heatmap.data = [linha("SC", 7028)];
    estado.heatmap.isError = true;
    estado.heatmap.error = SEM_REDE;
    montar();
    expect(screen.getByText("7.028 leads mapeados")).toBeTruthy();
    expect(screen.queryByText("Não foi possível carregar o mapa")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Não deu para atualizar o mapa");
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(estado.heatmap.refetch).toHaveBeenCalledTimes(1);
  });

  it("vazio: o mapa fica, mas diz por que está cinza — sem inventar '0 sem estado'", () => {
    estado.heatmap.data = [];
    montar();
    expect(screen.getByRole("status").textContent).toContain("Nenhum lead com estado identificado entre os que você vê");
    expect(screen.queryByText(/sem estado identificado$/)).toBeNull();
  });

  it("com dados: soma os mapeados, mostra os sem estado e cita as fontes sem prometer ERP a quem não tem", () => {
    estado.heatmap.data = [linha("SC", 6179, { clients_count: 10 }), linha("SP", 1718, { clients_count: 2 })];
    montar();
    expect(screen.getByText("7.897 leads mapeados")).toBeTruthy();
    expect(screen.getByText("1.673 leads")).toBeTruthy();
    expect(screen.getByText("Estado vem do cadastro, das integrações ou do DDD do telefone")).toBeTruthy();
    expect(screen.queryByText(/ERP/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("carregando: só o esqueleto", () => {
    estado.heatmap.isLoading = true;
    const { container } = montar();
    expect(screen.queryByText(/leads mapeados/)).toBeNull();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
});

describe("TabMapa — drawer do estado", () => {
  const abrirSC = (extra?: Partial<{ clients_count: number; total_sold: number }>) => {
    estado.heatmap.data = [linha("SC", 7028, extra)];
    const r = montar();
    fireEvent.click(r.container.querySelector("path#BRSC")!);
    return r;
  };

  it("abre com os números formatados e leva para a lista sem prometer quantos ela mostra", () => {
    abrirSC({ clients_count: 1309 });
    expect(screen.getByRole("heading", { name: "Santa Catarina" })).toBeTruthy();
    expect(screen.getByText("7.028")).toBeTruthy();
    expect(screen.getByText("1.309")).toBeTruthy();
    const ver = screen.getByRole("button", { name: "Ver em Leads →" });
    expect(ver.textContent).not.toMatch(/\d/);
    fireEvent.click(ver);
    expect(screen.getByText("destino /leads?uf=SC")).toBeTruthy();
  });

  it("get_leads_by_uf falhou: erro com 'Tentar de novo', nunca 'Nenhum lead neste estado.'", () => {
    estado.leads = { data: undefined, isLoading: false, isError: true, error: SEM_REDE, refetch: vi.fn() };
    abrirSC();
    expect(screen.getByRole("alert").textContent).toContain("Não foi possível carregar os leads deste estado");
    expect(screen.queryByText("Nenhum lead neste estado.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(estado.leads.refetch).toHaveBeenCalledTimes(1);
  });

  it("resposta vazia: 'Nenhum lead neste estado.' e nenhum alerta", () => {
    abrirSC();
    expect(screen.getByText("Nenhum lead neste estado.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sem receita na base: não afirma 'Vendido R$ 0'", () => {
    abrirSC();
    expect(screen.queryByText("Vendido")).toBeNull();
  });

  it("com receita: mostra o vendido do estado", () => {
    abrirSC({ total_sold: 128_749.35 });
    expect(screen.getByText("Vendido")).toBeTruthy();
    expect(screen.getByText("R$ 129K")).toBeTruthy();
  });

  it("selo: cliente sem venda no caderno (cadastro do ERP) é só Cliente; quem comprou sem ser cliente mostra o valor", () => {
    estado.leads = {
      data: [
        { id: "l1", name: "Cadastro do ERP", company: null, phone: null, uf_source: "erp", is_client: true, sold_value: 0, created_at: "2026-11-01" },
        { id: "l2", name: "Comprou pelo CRM", company: null, phone: null, uf_source: "ddd", is_client: false, sold_value: 40_000, created_at: "2026-11-02" },
        { id: "l3", name: "Só lead", company: null, phone: null, uf_source: "ddd", is_client: false, sold_value: 0, created_at: "2026-11-03" },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    abrirSC({ total_sold: 40_000 });
    expect(screen.getByText("Cliente")).toBeTruthy();
    expect(screen.getByText("Lead · R$ 40K")).toBeTruthy();
    expect(screen.getByText("Lead")).toBeTruthy();
  });
});

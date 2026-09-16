import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientPortfolio, type ClientPortfolioProps } from "./ClientPortfolio";
import { calcularCicloDeRecompra } from "../../lib/reorder-cycle";
vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ width: 1600 }),
}));
const now = Date.parse("2026-09-16T12:00:00Z");
const base: ClientPortfolioProps = {
  clients: [
    {
      id: "client-1",
      name: "Ana",
      company: "Aurora Distribuidora",
      identity: "Ana",
      cycle: calcularCicloDeRecompra(["2026-07-17", "2026-08-14"], now),
      deals: [],
      metrics: {
        leadId: "client-1",
        lifetimeValue: 184500,
        avgTicket: 10250,
        orderCount: 18,
        segment: "ouro",
        reorderCycleDays: 28,
        daysSinceLastOrder: 33,
      },
    },
  ],
  total: 342,
  summary: { monthlyRevenue: 428000, expectedCount: 28, overdueCount: 12 },
  segment: "all",
  onSegment: vi.fn(),
  reorder: "all",
  onReorder: vi.fn(),
  now,
  search: "",
  selectedId: "client-1",
  onSelect: vi.fn(),
  onSearch: vi.fn(),
  onNewDeal: vi.fn(),
  onOpenLead: vi.fn(),
  onOpenDeal: vi.fn(),
  onRetry: vi.fn(),
  canCreate: true,
};
describe("ClientPortfolio", () => {
  it("distingue última compra da próxima previsão retornada pelo banco", () => {
    render(<ClientPortfolio {...base} clients={[{ ...base.clients[0], lastPurchaseAt: "2026-08-14T12:00:00Z", nextPurchaseAt: "2026-09-11T12:00:00Z" }]} />);
    const row = screen.getByRole("button", { name: "Ver 360 de Aurora Distribuidora" }).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("14 ago");
    expect(cells[4]).toHaveTextContent("11 set");
    expect(cells[4]).not.toHaveTextContent("14 ago");
  });
  it("seleciona cliente e mantém identidade ao abrir novo negócio", () => {
    render(<ClientPortfolio {...base} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Ver 360 de Aurora Distribuidora" }),
    );
    expect(base.onSelect).toHaveBeenCalledWith("client-1");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Novo negócio para Aurora Distribuidora",
      }),
    );
    expect(base.onNewDeal).toHaveBeenCalledWith("client-1");
    fireEvent.click(screen.getByRole("button", { name: "Novo negócio" }));
    expect(base.onNewDeal).toHaveBeenLastCalledWith("client-1");
    expect(
      screen.getByRole("complementary", {
        name: "Cliente 360: Aurora Distribuidora",
      }),
    ).toBeInTheDocument();
  });
  it("bloqueia escrita sem permissão nas duas portas", () => {
    render(<ClientPortfolio {...base} canCreate={false} />);
    expect(
      screen.getByRole("button", {
        name: "Novo negócio para Aurora Distribuidora",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Novo negócio" })).toBeDisabled();
  });
  it("expõe erro sem fabricar valores zero", () => {
    render(<ClientPortfolio {...base} error />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Não foi possível carregar",
    );
    expect(screen.queryByText("R$ 184.500,00")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(base.onRetry).toHaveBeenCalled();
  });
  it("mostra estado vazio e encaminha busca", () => {
    render(
      <ClientPortfolio {...base} clients={[]} selectedId={null} total={0} />,
    );
    expect(screen.getByText("Nenhum cliente encontrado")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar cliente" }), {
      target: { value: "Aurora" },
    });
    expect(base.onSearch).toHaveBeenCalledWith("Aurora");
  });
});

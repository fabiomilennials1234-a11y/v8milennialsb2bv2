import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ClientPortfolioProps } from "./ClientPortfolio";
const mocks = vi.hoisted(() => ({ query: vi.fn(), deals: vi.fn(), purchases: vi.fn(), view: vi.fn() }));
vi.mock("../../hooks/useClientPortfolio", () => ({ useClientPortfolio: mocks.query, PORTFOLIO_PAGE_SIZE: 50 }));
vi.mock("../../hooks/useLeadsDeals", () => ({ useLeadsDeals: mocks.deals }));
vi.mock("../../hooks/useClientPortfolioPurchases", () => ({ useClientPortfolioPurchases: mocks.purchases }));
vi.mock("./ClientPortfolio", () => ({ ClientPortfolio: (props: ClientPortfolioProps) => {
  mocks.view(props);
  return <><button onClick={() => props.onSegment("ouro")}>Ouro</button><button onClick={() => props.onReorder("late")}>Atrasados</button>{props.pagination}</>;
} }));
import { ClientPortfolioSection } from "./ClientPortfolioSection";
const props = { filters: {}, filterControls: () => null, onSearch: vi.fn(), canCreate: true, onNewDeal: vi.fn(), onOpenLead: vi.fn(), onOpenDeal: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReturnValue({ data: { asOf: "2026-09-16T12:00:00Z", total: 101, clients: [{ id: "a" }], summary: { monthlyRevenue: 45000, expectedCount: 20, overdueCount: 7 } }, refetch: vi.fn() });
  mocks.deals.mockReturnValue({ data: {}, refetch: vi.fn() });
  mocks.purchases.mockReturnValue({ data: [], refetch: vi.fn() });
});
it("pagina no servidor, mantém resumo global e reseta página ao filtrar", () => {
  render(<ClientPortfolioSection {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  expect(mocks.query).toHaveBeenLastCalledWith({}, "all", "all", 1);
  expect(mocks.view.mock.lastCall?.[0].summary.monthlyRevenue).toBe(45000);
  fireEvent.click(screen.getByText("Ouro"));
  expect(mocks.query).toHaveBeenLastCalledWith({}, "ouro", "all", 0);
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  fireEvent.click(screen.getByText("Atrasados"));
  expect(mocks.query).toHaveBeenLastCalledWith({}, "ouro", "late", 0);
});
it("busca altera página e seleção removida volta ao primeiro cliente visível", () => {
  const { rerender } = render(<ClientPortfolioSection {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
  mocks.query.mockReturnValue({ data: { asOf: "2026-09-16T12:00:00Z", total: 1, clients: [{ id: "b" }] } });
  rerender(<ClientPortfolioSection {...props} filters={{ searchQuery: "B" }} />);
  expect(mocks.query).toHaveBeenLastCalledWith({ searchQuery: "B" }, "all", "all", 0);
  expect(mocks.purchases).toHaveBeenLastCalledWith("b");
  expect(mocks.deals).toHaveBeenLastCalledWith(["b"]);
});
it("erro de negócios não exibe zero negócios como verdade", () => {
  mocks.deals.mockReturnValue({ isError: true });
  render(<ClientPortfolioSection {...props} />);
  expect(mocks.view.mock.lastCall?.[0].error).toBe(true);
});

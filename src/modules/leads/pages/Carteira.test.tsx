/**
 * Página /carteira (CTO 2026-10-16) — a antiga aba Clientes de /leads.
 *
 * Prova a ligação da página, não a carteira em si (essa é coberta por
 * `ClientPortfolioSection.test.tsx`/`ClientPortfolio.test.tsx`): cabeçalho
 * próprio, recorte `cliente` com a lei de classificação da org, filtros da aba,
 * "Limpar", "Novo negócio", abrir lead/negócio e o deep-link `?lead=`.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  section: vi.fn(),
  openLead: vi.fn(),
  openDeal: vi.fn(),
  newDeal: vi.fn(),
  usaLeiDoErp: false,
  cafe: false,
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", teamMemberId: "tm-1" }),
  useCanDo: () => ({ allowed: true }),
  useResponsibleMembers: () => [{ id: "tm-2", name: "João" }],
}));
vi.mock("@/lib/analytics", () => ({ trackModuleVisit: vi.fn() }));
vi.mock("@/modules/platform/components/layout/LeadPanelLayout", () => ({
  LeadPanelLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../components/lead-detail", () => ({
  LeadPanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useLeadSheet: () => ({ openLead: mocks.openLead }),
}));
vi.mock("../components/deal-detail/DealPanelProvider", () => ({
  DealPanelProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../components/deal-detail/deal-sheet-context", () => ({
  useDealSheet: () => ({ openDeal: mocks.openDeal }),
}));
vi.mock("../components/lead-card/LeadCardPanel", () => ({ LeadCardPanel: () => null }));
vi.mock("../components/deal-card/DealCardPanel", () => ({ DealCardPanel: () => null }));
vi.mock("../components/lead-card/LeadCardNewDeal", () => ({
  LeadCardNewDeal: (props: { leadId: string }) => {
    mocks.newDeal(props.leadId);
    return <div>NOVO NEGÓCIO {props.leadId}</div>;
  },
}));
vi.mock("../hooks/useOrgUsaLeiDoErp", () => ({ useOrgUsaLeiDoErp: () => ({ usaLeiDoErp: mocks.usaLeiDoErp }) }));
vi.mock("../hooks/useClassificacaoCafeJurere", () => ({ useClassificacaoCafeJurere: () => mocks.cafe }));
vi.mock("../components/client-portfolio/ClientPortfolioSection", () => ({
  ClientPortfolioSection: (props: {
    filters: Record<string, unknown>;
    filterControls: (clear: () => void) => ReactNode;
    onSearch: (v: string) => void;
    onNewDeal: (id: string) => void;
    onOpenLead: (id: string) => void;
    onOpenDeal: (deal: { id: string; leadId: string }) => void;
    canCreate: boolean;
  }) => {
    mocks.section(props);
    return (
      <div>
        {props.filterControls(vi.fn())}
        <button onClick={() => props.onSearch("ana")}>buscar</button>
        <button onClick={() => props.onNewDeal("L7")}>novo negócio</button>
        <button onClick={() => props.onOpenLead("L8")}>abrir lead</button>
        <button onClick={() => props.onOpenDeal({ id: "D1", leadId: "L9" })}>abrir negócio</button>
      </div>
    );
  },
}));

import Carteira from "./Carteira";

const renderAt = (path = "/carteira") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Carteira />
    </MemoryRouter>,
  );
const lastFilters = () => mocks.section.mock.lastCall?.[0].filters;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.usaLeiDoErp = false;
  mocks.cafe = false;
});

describe("/carteira", () => {
  it("tem cabeçalho próprio — Carteira, não Leads", () => {
    renderAt();
    expect(screen.getByRole("heading", { name: "Carteira" })).toBeInTheDocument();
    expect(screen.getByText("Quem já compra — e quando volta a comprar.")).toBeInTheDocument();
  });

  it("recorta `cliente` pela lei de classificação da org", () => {
    mocks.usaLeiDoErp = true;
    mocks.cafe = true;
    renderAt();
    expect(lastFilters()).toMatchObject({
      filterClassificacao: "cliente",
      usaLeiDoErp: true,
      usaCadastroErpCafeJurere: true,
      searchQuery: "",
      filterOrigin: "all",
      filterQualification: "all",
      filterResponsible: "all",
    });
  });

  it("mostra os filtros da aba antiga (origem, qualificação, dono, limpar)", () => {
    renderAt();
    expect(screen.getByRole("combobox", { name: "Origem dos clientes" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Qualificação dos clientes" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Dono da conta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
  });

  it("busca filtra e Limpar volta ao padrão", () => {
    renderAt();
    fireEvent.click(screen.getByText("buscar"));
    expect(lastFilters()).toMatchObject({ searchQuery: "ana" });
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(lastFilters()).toMatchObject({ searchQuery: "" });
  });

  it("abre lead, negócio e Novo negócio como a aba fazia", () => {
    renderAt();
    fireEvent.click(screen.getByText("abrir lead"));
    expect(mocks.openLead).toHaveBeenCalledWith("L8");
    fireEvent.click(screen.getByText("abrir negócio"));
    expect(mocks.openDeal).toHaveBeenCalledWith("D1", "L9");
    fireEvent.click(screen.getByText("novo negócio"));
    expect(screen.getByText("NOVO NEGÓCIO L7")).toBeInTheDocument();
  });

  it("deep-link ?lead= abre o Card do Lead", () => {
    renderAt("/carteira?lead=L1");
    expect(mocks.openLead).toHaveBeenCalledWith("L1");
  });
});

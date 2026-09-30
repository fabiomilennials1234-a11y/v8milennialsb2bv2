import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  org: "36971ff5-fd73-4f30-a733-04bf8c90e5b6",
  openDeal: vi.fn(),
  negocios: [] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: state.org }),
  useResponsibleMembers: () => [],
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({ useTags: () => ({ data: [] }) }));
vi.mock("@/modules/communication/components/chat/LeadContactModal", () => ({ LeadContactModal: () => null }));
vi.mock("../ContextPanelFunnels", () => ({ ContextPanelFunnels: () => <div>funis</div> }));
vi.mock("../contextPanelInfoHelpers", () => ({
  memberById: () => null,
  memberName: () => null,
  tierLabel: () => null,
}));
vi.mock("@/modules/leads", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    useUpdateLead: () => ({ mutate: vi.fn(), isPending: false }),
    LeadCustomFields: () => null,
    AddCustomFieldPopover: () => null,
    ResponsibleSlot: () => null,
    QualificationSlot: () => null,
    LeadPanelProvider: Pass,
    DealPanelProvider: Pass,
    DealCardPanel: () => <div data-testid="deal-card-panel" />,
    LeadCardPanel: () => null,
    useDealSheet: () => ({ openDeal: state.openDeal }),
  };
});
vi.mock("@/modules/communication/hooks/chat/useNegociosDoLeadNoChat", () => ({
  useNegociosDoLeadNoChat: () => ({ negocios: state.negocios, isLoading: false }),
}));

import { ContextPanelTabInfo } from "../ContextPanelTabInfo";

const LEAD = { id: "lead", phone: "+5521966418551", organization_id: state.org };

function renderPainel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ContextPanelTabInfo lead={LEAD} activeLeadId="lead" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.org = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";
  state.openDeal.mockReset();
  state.negocios = [
    {
      id: "entry-1", leadId: "lead", titulo: "Ricardo POSSEBON", estado: "aberto",
      funil: "Funil Mustang", funilCor: "#f00", etapa: "Negociando", valor: 84739,
      dono: "Thiago Assumpção", criadoEm: "2026-09-23T12:00:00Z", diasNaEtapa: 7,
      caminho: "/funil/mustang", vendaHistorica: false,
    },
  ];
});

describe("Negócios no painel do chat", () => {
  it("Riofix vê o resumo do negócio ao lado da conversa", () => {
    renderPainel();
    expect(screen.getByText("Negócios")).toBeInTheDocument();
    expect(screen.getByText("Ricardo POSSEBON")).toBeInTheDocument();
    expect(screen.getByText(/84\.739,00/)).toBeInTheDocument();
    expect(screen.getByText("Thiago Assumpção")).toBeInTheDocument();
    expect(screen.getByText("Negociando")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /no funil/ })).toHaveAttribute("href", "/funil/mustang");
  });

  it("clicar no negócio abre o Card do Negócio sem sair do chat", () => {
    renderPainel();
    fireEvent.click(screen.getByRole("button", { name: "Abrir negócio Ricardo POSSEBON" }));
    expect(state.openDeal).toHaveBeenCalledWith("entry-1", "lead");
    expect(screen.getByTestId("deal-card-panel")).toBeInTheDocument();
  });

  it("outra org não vê a seção nem monta o card", () => {
    state.org = "6030520a-2ca7-477d-be89-55758e2cd808";
    renderPainel();
    expect(screen.queryByText("Negócios")).not.toBeInTheDocument();
    expect(screen.queryByText("Ricardo POSSEBON")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deal-card-panel")).not.toBeInTheDocument();
    expect(screen.getByText("funis")).toBeInTheDocument();
  });

  it("venda histórica aparece, mas não finge abrir card", () => {
    state.negocios = [{ ...(state.negocios[0] as object), vendaHistorica: true, caminho: null }];
    renderPainel();
    expect(screen.getByText("Ricardo POSSEBON")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir negócio/ })).not.toBeInTheDocument();
  });
});

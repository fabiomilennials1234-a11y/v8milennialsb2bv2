import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  org: "36971ff5-fd73-4f30-a733-04bf8c90e5b6",
  openDeal: vi.fn(),
  negocios: [] as unknown[],
  isError: false,
  refetch: vi.fn(),
  panelMounts: 0,
  gate: { allowed: true, isLoading: false, reason: "Sem permissão para adicionar a funis" },
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
    DealCardPanel: () => {
      const [mountId] = React.useState(() => ++state.panelMounts);
      return <div data-testid="deal-card-panel" data-mount={mountId} />;
    },
    LeadCardPanel: () => null,
    LeadNewDealDialog: ({ leadId, onOpenChange }: { leadId: string; onOpenChange: (open: boolean) => void }) => (
      <div role="dialog" aria-label="Novo negócio">
        <span>{leadId}</span><button onClick={() => onOpenChange(false)}>Cancelar</button>
      </div>
    ),
    useLeadActionGates: () => ({ canAddToPipe: state.gate }),
    useDealSheet: () => ({ openDeal: state.openDeal }),
  };
});
vi.mock("@/modules/communication/hooks/chat/useNegociosDoLeadNoChat", () => ({
  useNegociosDoLeadNoChat: () => ({ negocios: state.negocios, isLoading: false, isError: state.isError, refetch: state.refetch }),
}));

import { ContextPanelTabInfo } from "../ContextPanelTabInfo";

const LEAD = { id: "lead", phone: "+5521966418551", organization_id: state.org };

function renderPainel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  const view = (id: string) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ContextPanelTabInfo lead={{ ...LEAD, id }} activeLeadId={id} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const rendered = render(view("lead"));
  return { ...rendered, mudarLead: (id: string) => rendered.rerender(view(id)) };
}

beforeEach(() => {
  state.org = "36971ff5-fd73-4f30-a733-04bf8c90e5b6";
  state.openDeal.mockReset();
  state.isError = false;
  state.refetch.mockReset();
  state.panelMounts = 0;
  state.gate.allowed = true;
  state.gate.isLoading = false;
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
    expect(screen.queryByRole("button", { name: "Adicionar negócio" })).not.toBeInTheDocument();
    expect(screen.getByText("funis")).toBeInTheDocument();
  });

  it("venda histórica aparece, mas não finge abrir card", () => {
    state.negocios = [{ ...(state.negocios[0] as object), vendaHistorica: true, caminho: null }];
    renderPainel();
    expect(screen.getByText("Ricardo POSSEBON")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Abrir negócio/ })).not.toBeInTheDocument();
    expect(screen.getByText("Venda em")).toBeInTheDocument();
    expect(screen.queryByText("Criado em")).not.toBeInTheDocument();
  });

  it("informa falha e permite tentar novamente sem afirmar que o lead não tem negócio", () => {
    state.isError = true;
    state.negocios = [];
    renderPainel();
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar os negócios.");
    expect(screen.queryByText("Lead sem negócio")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it("descarta o card da conversa anterior ao mudar o lead", () => {
    const { mudarLead } = renderPainel();
    const originalMount = screen.getByTestId("deal-card-panel").getAttribute("data-mount");
    mudarLead("outro-lead");
    expect(screen.getByTestId("deal-card-panel").getAttribute("data-mount")).not.toBe(originalMount);
  });

  it("oferece criação mesmo sem negócio e só monta o formulário ao clicar", () => {
    state.negocios = [];
    renderPainel();
    expect(screen.getByText("Lead sem negócio")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar negócio" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("lead");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["negada", "carregando"])("bloqueia a criação com permissão %s", (status) => {
    state.gate.allowed = status !== "negada";
    state.gate.isLoading = status === "carregando";
    renderPainel();
    expect(screen.getByRole("button", { name: "Adicionar negócio" })).toBeDisabled();
  });

  it("fecha a criação antiga ao trocar de lead e usa o novo alvo na próxima abertura", () => {
    const { mudarLead } = renderPainel();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar negócio" }));
    mudarLead("outro-lead");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar negócio" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("outro-lead");
  });

  it("descarta o formulário ao mudar de organização", () => {
    const { mudarLead } = renderPainel();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar negócio" }));
    state.org = "outra-org";
    mudarLead("lead");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar negócio" })).not.toBeInTheDocument();
  });
});

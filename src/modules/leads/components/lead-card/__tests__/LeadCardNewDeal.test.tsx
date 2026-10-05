import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pipelines: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  custom: { data: [], isPending: false, isError: false, refetch: vi.fn() },
  proposal: { data: null, isPending: false, isError: false, refetch: vi.fn() },
  gate: { allowed: true, isLoading: false },
  create: vi.fn(),
  close: vi.fn(),
  pipelineTargets: vi.fn(),
}));

vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm-1", organization_id: "riofix" }, isPending: false, refetch: vi.fn() }),
  useResponsibleMembers: () => [{ id: "tm-1", name: "Thiago" }],
  isVirtualTeamMember: () => false,
}));
vi.mock("../../../hooks/useLeadAllPipelines", () => ({
  useLeadAllPipelines: (leadId: string | null) => {
    state.pipelineTargets(leadId);
    return state.pipelines;
  },
  useAddLeadToStandardPipe: () => ({ mutateAsync: state.create, isPending: false }),
  assertMemberInOrg: vi.fn(),
}));
vi.mock("../../../pipe-ops", () => ({
  usePipeOps: () => ({
    useCustomPipelines: () => state.custom,
    usePipePropostaByLeadId: () => state.proposal,
    useAddLeadToCustomPipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
  }),
}));
vi.mock("../../lead-detail/hooks/useLeadActionGates", () => ({
  useLeadActionGates: () => ({ canAddToPipe: state.gate }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LeadCardNewDeal } from "../LeadCardNewDeal";

function form(open = true) {
  return <LeadCardNewDeal leadId="lead-da-conversa" open={open} onOpenChange={state.close} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.create.mockResolvedValue({});
  state.gate = { allowed: true, isLoading: false };
  for (const query of [state.pipelines, state.custom, state.proposal]) {
    query.isPending = false;
    query.isError = false;
  }
  state.pipelines.data = [{
    type: "standard", pipeType: "propostas", label: "Orçamentos", color: "#fa0",
    pipelineDbId: "funil-1", pipeId: null, currentStage: null, currentStageLabel: null,
    stages: [{ id: "orcamento", label: "Orçamento enviado", color: "#fa0" }],
  }];
});

describe("Criação de negócio compartilhada pelo chat e card", () => {
  it("não busca os negócios do lead enquanto fechado", () => {
    render(form(false));
    expect(state.pipelineTargets).toHaveBeenLastCalledWith(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["pipelines", "custom", "proposal", "gate"] as const)("aguarda %s e pré-seleciona funil/etapa quando prontos", (dependency) => {
    if (dependency === "gate") state.gate.isLoading = true;
    else state[dependency].isPending = true;
    const { rerender } = render(form());
    expect(screen.getByRole("status")).toHaveTextContent("Carregando funis e permissões");
    expect(screen.queryByTestId("new-deal-sem-funil")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-deal-submit")).not.toBeInTheDocument();
    if (dependency === "gate") state.gate.isLoading = false;
    else state[dependency].isPending = false;
    rerender(form());
    expect(screen.getByTestId("new-deal-option-sys:propostas")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("new-deal-stage")).toHaveTextContent("Orçamento enviado");
    expect(screen.getByTestId("new-deal-submit")).toBeEnabled();
  });

  it("mostra erro de leitura e permite recarregar antes de criar", () => {
    state.pipelines.isError = true;
    const { rerender } = render(form());
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar os funis");
    expect(screen.queryByTestId("new-deal-submit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(state.pipelines.refetch).toHaveBeenCalledOnce();
    state.pipelines.isError = false;
    rerender(form());
    expect(screen.getByTestId("new-deal-submit")).toBeEnabled();
  });

  it("envia o lead da conversa, etapa, vendedor, valor e observação pela criação canônica", async () => {
    render(form());
    fireEvent.change(screen.getByTestId("new-deal-value"), { target: { value: "1.250,50" } });
    fireEvent.change(screen.getByTestId("new-deal-notes"), { target: { value: "Reposição" } });
    fireEvent.click(screen.getByTestId("new-deal-submit"));
    await waitFor(() => expect(state.close).toHaveBeenCalledWith(false));
    expect(state.create).toHaveBeenCalledExactlyOnceWith({
      leadId: "lead-da-conversa", pipeType: "propostas", stageId: "orcamento",
      ownerId: "tm-1", saleValue: 1250.5, meetingDate: null, notes: "Reposição",
    });
  });

  it("preserva rascunho e permite nova tentativa quando a criação falha", async () => {
    state.create.mockRejectedValueOnce(new Error("Servidor indisponível"));
    render(form());
    fireEvent.change(screen.getByTestId("new-deal-notes"), { target: { value: "Reposição" } });
    fireEvent.click(screen.getByTestId("new-deal-submit"));
    await waitFor(() => expect(screen.getByTestId("new-deal-submit")).toBeEnabled());
    expect(state.close).not.toHaveBeenCalled();
    expect(screen.getByTestId("new-deal-notes")).toHaveValue("Reposição");
    fireEvent.click(screen.getByTestId("new-deal-submit"));
    await waitFor(() => expect(state.close).toHaveBeenCalledWith(false));
    expect(state.create).toHaveBeenCalledTimes(2);
  });
});

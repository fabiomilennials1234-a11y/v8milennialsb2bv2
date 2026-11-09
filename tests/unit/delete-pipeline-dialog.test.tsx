/** Todos os funis usam a mesma confirmação de exclusão e preservam as guardas de impacto. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Ordem das escritas — a asserção central do fluxo do substituto.
const callOrder: string[] = [];

const updateSettings = vi.fn(async (payload: Record<string, unknown>) => {
  callOrder.push(`updateSettings:${JSON.stringify(payload)}`);
  return {};
});
let mockDefaultPipelineId: string | null = null;
vi.mock("@/modules/identity", () => ({
  useOrganizationSettings: () => ({
    settings: {
      confirmacao_overdue_days: 3,
      default_reorder_cycle_days: 30,
      default_pipeline_id: mockDefaultPipelineId,
    },
    updateSettings,
    isAdmin: true,
    isLoading: false,
    isUpdating: false,
  }),
}));

let mockImpact: Record<string, number> | null = null;
vi.mock("@/modules/pipelines/hooks/config/usePipelineDelete", () => ({
  usePipelineDeleteImpact: () => ({ data: mockImpact }),
  useDeletePipelineById: () => ({
    mutateAsync: vi.fn(async (id: string) => {
      callOrder.push(`delete:${id}`);
      return { cards: 3 };
    }),
    isPending: false,
  }),
}));

vi.mock("@/modules/pipelines/hooks/model/usePipelines", () => ({
  usePipelines: () => ({
    data: [
      { id: "pipe-a", name: "Oportunidades", type: "system", slug: "whatsapp", is_active: true },
      { id: "pipe-b", name: "Pós-venda", type: "custom", slug: "pos-venda", is_active: true },
      { id: "pipe-c", name: "Orçamentos", type: "system", slug: "propostas", is_active: true },
    ],
  }),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));


import { DeletePipelineDialog } from "@/modules/pipelines/components/shared/DeletePipelineDialog";

const pipelineA = { id: "pipe-a", name: "Oportunidades", type: "system" as const };

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  mockDefaultPipelineId = null;
  mockImpact = { cards: 3, leads: 2, etapas: 4, eventos_etapa: 0, vendas_orfas: 0, automacoes: 0 };
});

describe("DeletePipelineDialog — sem designação de padrão", () => {
  it("um antigo padrão é um funil comum e não exige substituto", async () => {
    mockDefaultPipelineId = "pipe-a";
    render(<DeletePipelineDialog open onOpenChange={() => {}} pipeline={pipelineA} />);
    expect(screen.queryByText(/funil padrão/)).toBeNull();
    expect(screen.queryByTestId("substitute-select")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^excluir funil$/i }));
    await waitFor(() => expect(callOrder).toEqual(["delete:pipe-a"]));
    expect(updateSettings).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith("/funis");
  });
});

describe("DeletePipelineDialog — fluxos sem substituto", () => {
  it("funil que não é o padrão: exclui direto, sem tocar no padrão", async () => {
    mockDefaultPipelineId = "pipe-c";
    render(
      <DeletePipelineDialog open onOpenChange={() => {}} pipeline={pipelineA} />,
    );

    expect(screen.queryByTestId("substitute-select")).toBeNull();
    fireEvent.click(screen.getByText(/^excluir funil$/i).closest("button")!);

    await waitFor(() => expect(callOrder).toEqual(["delete:pipe-a"]));
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("cards invasores bloqueiam: sem botão destrutivo, só 'Entendi'", async () => {
    mockImpact = { ...mockImpact!, cards_invasores: 2 };
    render(
      <DeletePipelineDialog
        open
        onOpenChange={() => {}}
        pipeline={{ id: "pipe-b", name: "Pós-venda", type: "custom" }}
      />,
    );

    expect(await screen.findByText(/Não dá para excluir agora/)).toBeTruthy();
    expect(screen.queryByText(/^excluir funil$/i)).toBeNull();
    expect(screen.getByText("Entendi")).toBeTruthy();
    expect(callOrder.length).toBe(0);
  });
});

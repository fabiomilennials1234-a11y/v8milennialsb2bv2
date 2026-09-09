/**
 * SCRUM-636 (D3) · DeletePipelineDialog — o diálogo definitivo de exclusão de
 * funil, sobre o par único da 626 (pipeline_delete_impact + delete_pipeline).
 *
 * Prova:
 *  1. Funil PADRÃO da org (624): ação travada sem substituto; escolhido o
 *     substituto, `organizations.default_pipeline_id` é atualizado ANTES do
 *     delete (a ordem mata o erro cru do trigger pipeline_is_org_default).
 *  2. "Nenhum" é escolha válida: limpa o padrão (null) e exclui.
 *  3. Funil comum: exclui direto, sem tocar no padrão.
 *  4. cards_invasores > 0: BLOQUEIO — sem botão destrutivo.
 */
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

// Radix Select não opera em jsdom — select nativo no lugar.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      data-testid="substitute-select"
      value={value ?? ""}
      onChange={(e) => onValueChange((e.target as HTMLSelectElement).value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

import { DeletePipelineDialog } from "@/modules/pipelines/components/shared/DeletePipelineDialog";

const pipelineA = { id: "pipe-a", name: "Oportunidades", type: "system" as const };

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  mockDefaultPipelineId = null;
  mockImpact = { cards: 3, leads: 2, etapas: 4, eventos_etapa: 0, vendas_orfas: 0, automacoes: 0 };
});

describe("DeletePipelineDialog — funil padrão da org (624)", () => {
  it("trava a ação sem substituto; com substituto, atualiza o padrão ANTES do delete", async () => {
    mockDefaultPipelineId = "pipe-a";
    render(
      <DeletePipelineDialog open onOpenChange={() => {}} pipeline={pipelineA} />,
    );

    expect((await screen.findAllByText(/funil padrão/)).length).toBeGreaterThan(0);
    const acao = screen.getByText("Excluir Funil").closest("button")!;
    expect(acao).toHaveProperty("disabled", true);

    // O próprio funil não é opção de substituto.
    const select = screen.getByTestId("substitute-select");
    expect(select.innerHTML).not.toContain(">Oportunidades<");

    fireEvent.change(select, { target: { value: "pipe-b" } });
    const acaoDepois = screen.getByText("Excluir Funil").closest("button")!;
    expect(acaoDepois).toHaveProperty("disabled", false);
    fireEvent.click(acaoDepois);

    await waitFor(() => expect(callOrder.length).toBe(2));
    // A ORDEM é o contrato: substituto entra antes do delete.
    expect(callOrder[0]).toBe('updateSettings:{"default_pipeline_id":"pipe-b"}');
    expect(callOrder[1]).toBe("delete:pipe-a");
    expect(navigateMock).toHaveBeenCalledWith("/funis");
  });

  it('"Nenhum" é escolha explícita válida: limpa o padrão e exclui', async () => {
    mockDefaultPipelineId = "pipe-a";
    render(
      <DeletePipelineDialog open onOpenChange={() => {}} pipeline={pipelineA} />,
    );

    fireEvent.change(screen.getByTestId("substitute-select"), {
      target: { value: "__none__" },
    });
    fireEvent.click(screen.getByText("Excluir Funil").closest("button")!);

    await waitFor(() => expect(callOrder.length).toBe(2));
    expect(callOrder[0]).toBe('updateSettings:{"default_pipeline_id":null}');
    expect(callOrder[1]).toBe("delete:pipe-a");
  });
});

describe("DeletePipelineDialog — fluxos sem substituto", () => {
  it("funil que não é o padrão: exclui direto, sem tocar no padrão", async () => {
    mockDefaultPipelineId = "pipe-c";
    render(
      <DeletePipelineDialog open onOpenChange={() => {}} pipeline={pipelineA} />,
    );

    expect(screen.queryByTestId("substitute-select")).toBeNull();
    fireEvent.click(screen.getByText("Excluir Funil").closest("button")!);

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
    expect(screen.queryByText("Excluir Funil")).toBeNull();
    expect(screen.getByText("Entendi")).toBeTruthy();
    expect(callOrder.length).toBe(0);
  });
});

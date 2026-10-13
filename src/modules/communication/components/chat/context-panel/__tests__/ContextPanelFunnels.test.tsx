import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStatus } from "@/modules/leads/hooks/useLeadAllPipelines";

const state = vi.hoisted(() => ({
  pipelines: undefined as unknown,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
  move: vi.fn(),
  capturar: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
vi.mock("@/modules/leads", async () => {
  const { funisSemNegocioAberto } = await import("@/modules/leads/lib/negocio-aberto");
  const { etapaDoLeadEhDePerda } = await import("@/modules/leads/lib/etapa-de-perda");
  return {
    funisSemNegocioAberto,
    etapaDoLeadEhDePerda,
    useLossReasonGate: () => ({ capturarMotivoDaPerda: state.capturar, requestLossReason: vi.fn() }),
    useLeadAllPipelines: () => ({
      data: state.pipelines,
      isLoading: state.isLoading,
      isError: state.isError,
      refetch: state.refetch,
    }),
    useLeadActionGates: () => ({
      canMoveMeeting: { allowed: true },
      canAddToPipe: { allowed: true },
    }),
  };
});
vi.mock("@/modules/pipelines", () => ({
  useMovePipelineEntry: () => ({ mutate: state.move, isPending: false }),
  useCreatePipelineEntry: () => ({ mutate: vi.fn(), isPending: false }),
  usePipelineDisplayConfig: () => ({ data: [] }),
}));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));

import { ContextPanelFunnels } from "../ContextPanelFunnels";

const STAGES = [
  { id: "stage-1", name: "Em andamento", color: "#f59e0b", position: 0, role: "open" },
  { id: "stage-2", name: "Vendido", color: "#22c55e", position: 1, role: "won" },
];

const COM_NEGOCIO: PipelineStatus[] = [
  {
    type: "custom", pipelineId: "pipe-envase", pipelineName: "Envase", pipelineColor: "#f59e0b",
    pipelineIcon: "", entryId: "entry-1", closedAt: null, currentStageId: "stage-1",
    currentStageName: "Em andamento", stages: STAGES,
  },
  {
    type: "custom", pipelineId: "pipe-cafe", pipelineName: "Cafeteria", pipelineColor: "#6366f1",
    pipelineIcon: "", entryId: null, currentStageId: null, currentStageName: null,
    stages: [{ id: "stage-3", name: "Novo", color: "#6366f1", position: 0 }],
  },
];

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ContextPanelFunnels leadId="lead-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.pipelines = undefined;
  state.isLoading = false;
  state.isError = false;
  state.refetch.mockReset();
  state.move.mockReset();
  state.capturar.mockReset();
});

describe("ContextPanelFunnels — card Funis do lead no chat", () => {
  // Chamados 6bdadd97 / f055fbd8: a leitura falhava e o card dizia "sem funil".
  it("leitura com erro mostra erro com retry, nunca 'sem funil' nem botão de adicionar", () => {
    state.isError = true;
    renderCard();
    expect(screen.getByTestId("chat-funis-erro")).toHaveTextContent("Não foi possível carregar os funis");
    expect(screen.queryByText("Lead não está em nenhum funil")).not.toBeInTheDocument();
    expect(screen.queryByText("Adicionar a um funil")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });

  it("com dados mostra o chip da etapa e 'Adicionar a um funil'", () => {
    state.pipelines = COM_NEGOCIO;
    renderCard();
    expect(screen.getByText("Envase")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Etapa em Envase: Em andamento" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar a um funil" })).toBeInTheDocument();
    expect(screen.queryByTestId("chat-funis-erro")).not.toBeInTheDocument();
  });

  describe("mover para etapa de perda pede o motivo (porta única)", () => {
    const PERDA_STAGES = [
      { id: "stage-1", name: "Em andamento", color: "#f59e0b", position: 0, role: "open" },
      // Mustang/Riofix: perda só pela flag, role open.
      { id: "stage-x", name: "Perdido/Desqualificado", color: "#ef4444", position: 1, role: "open", isFinalNegative: true },
      { id: "stage-l", name: "Perda", color: "#ef4444", position: 2, role: "lost" },
    ];
    const COM_PERDA: PipelineStatus[] = [
      {
        type: "custom", pipelineId: "pipe-mustang", pipelineName: "Mustang", pipelineColor: "#f59e0b",
        pipelineIcon: "", entryId: "entry-1", closedAt: null, currentStageId: "stage-1",
        currentStageName: "Em andamento", stages: PERDA_STAGES,
      },
    ];

    async function escolher(etapa: string) {
      fireEvent.click(screen.getByRole("button", { name: "Etapa em Mustang: Em andamento" }));
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(etapa) }));
    }

    it("etapa só com is_final_negative: pede o motivo e só move depois de gravado", async () => {
      state.pipelines = COM_PERDA;
      state.capturar.mockResolvedValue({ id: "lr-1", texto: "Sem budget" });
      renderCard();
      await escolher("Perdido/Desqualificado");
      await waitFor(() => expect(state.move).toHaveBeenCalledTimes(1));
      expect(state.capturar).toHaveBeenCalledWith({ entryIds: ["entry-1"], stageName: "Perdido/Desqualificado" });
      expect(state.move.mock.calls[0][0]).toEqual({ id: "entry-1", stageId: "stage-x" });
      // Não cai no AlertDialog de ganho.
      expect(screen.queryByText("Marcar como Ganho?")).not.toBeInTheDocument();
    });

    it("cancelar o motivo não move nada", async () => {
      state.pipelines = COM_PERDA;
      state.capturar.mockResolvedValue(null);
      renderCard();
      await escolher("^Perda");
      await waitFor(() => expect(state.capturar).toHaveBeenCalledTimes(1));
      expect(state.move).not.toHaveBeenCalled();
    });

    it("etapa aberta move direto, sem pedir motivo", async () => {
      state.pipelines = COM_PERDA.map((p) => ({ ...p, currentStageId: "stage-l", currentStageName: "Perda" })) as PipelineStatus[];
      renderCard();
      fireEvent.click(screen.getByRole("button", { name: "Etapa em Mustang: Perda" }));
      fireEvent.click(await screen.findByRole("button", { name: /Em andamento/ }));
      await waitFor(() => expect(state.move).toHaveBeenCalledTimes(1));
      expect(state.capturar).not.toHaveBeenCalled();
    });
  });
});
